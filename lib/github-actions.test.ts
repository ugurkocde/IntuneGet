import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  triggerPackagingWorkflow,
  type GitHubActionsConfig,
  type WorkflowInputs,
} from './github-actions';
import { buildQaPackageIdentityFromWorkflowInput } from './qa/package-profile';

const { enforceInstallerPreflightMock, enforceQaGateMock, reconcileCatalogInstallerMock, resolveDependenciesMock } = vi.hoisted(() => ({
  enforceInstallerPreflightMock: vi.fn(),
  enforceQaGateMock: vi.fn(),
  reconcileCatalogInstallerMock: vi.fn(),
  resolveDependenciesMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('./catalog-installer-reconciliation', () => ({
  reconcileCatalogInstaller: reconcileCatalogInstallerMock,
}));

vi.mock('./installer-preflight', async (importOriginal) => {
  const original = await importOriginal<typeof import('./installer-preflight')>();
  return {
    ...original,
    enforceInstallerPreflight: enforceInstallerPreflightMock,
  };
});

vi.mock('./qa/gate', async (importOriginal) => {
  const original = await importOriginal<typeof import('./qa/gate')>();
  return { ...original, enforceQaGate: enforceQaGateMock };
});

vi.mock('./winget-dependencies', async (importOriginal) => {
  const original = await importOriginal<typeof import('./winget-dependencies')>();
  return {
    ...original,
    resolveWingetPackageDependencies: resolveDependenciesMock,
  };
});

const config: GitHubActionsConfig = {
  token: 'test-token',
  owner: 'example',
  repo: 'public-repo',
  workflowsRepo: 'workflow-repo',
  workflowFile: 'package-intunewin.yml',
  ref: 'main',
};

function workflowInputs(overrides: Partial<WorkflowInputs> = {}): WorkflowInputs {
  return {
    jobId: '4a4f09e2-cc56-4ad2-a264-38b8f91e79c7',
    tenantId: '11111111-1111-1111-1111-111111111111',
    wingetId: 'Custom.Example.App',
    displayName: 'Example App',
    publisher: 'Example',
    version: '1.0.0',
    architecture: 'x64',
    installerUrl: 'https://example.com/setup.exe',
    installerSha256: '',
    installerType: 'exe',
    silentSwitches: '/S',
    uninstallCommand: 'uninstall.exe /S',
    callbackUrl: 'https://example.test/api/package/callback',
    hashValidationMode: 'calculate',
    sourceType: 'custom',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

reconcileCatalogInstallerMock.mockImplementation(async (item) => ({
  item,
  trustedInstallers: [],
}));

describe('triggerPackagingWorkflow hash validation payload', () => {
  it('reconciles a WinGet tuple and passes trusted installers to preflight', async () => {
    const trustedInstallers = [{
      architecture: 'x64',
      url: 'https://example.com/refreshed.exe',
      sha256: 'B'.repeat(64),
      type: 'exe',
      scope: 'machine',
    }];
    reconcileCatalogInstallerMock.mockImplementationOnce(async (item) => ({
      item: {
        ...item,
        installerUrl: trustedInstallers[0].url,
        installerSha256: trustedInstallers[0].sha256,
        installCommand: '/quiet',
        uninstallCommand: 'uninstall.exe /quiet',
      },
      trustedInstallers,
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(workflowInputs({
      wingetId: 'Example.App',
      sourceType: 'winget',
      installerSha256: 'A'.repeat(64),
    }), config, { skipRunCapture: true });

    expect(enforceInstallerPreflightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        installerUrl: trustedInstallers[0].url,
        installerSha256: trustedInstallers[0].sha256,
      }),
      trustedInstallers,
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.client_payload.installer).toEqual(expect.objectContaining({
      url: trustedInstallers[0].url,
      sha256: trustedInstallers[0].sha256,
      silentSwitches: '/quiet',
    }));
  });

  it('dispatches reviewed Movavi success codes through the customer packager', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(workflowInputs({
      wingetId: 'Movavi.MovaviPhotoFocus',
      displayName: 'Movavi Photo Focus',
      publisher: 'Movavi',
      version: '1.1.0',
      architecture: 'x86',
      installerSha256: 'A'.repeat(64),
      sourceType: 'winget',
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:Movavi Photo Focus',
    }), config, { skipRunCapture: true });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(JSON.parse(payload.client_payload.installer.successCodes)).toEqual([1223]);
  });

  it('dispatches JetBrains Toolbox headless removal through the customer packager', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(workflowInputs({
      wingetId: 'JetBrains.Toolbox',
      displayName: 'JetBrains Toolbox',
      publisher: 'JetBrains',
      version: '3.7.2.0',
      installerSha256: 'A'.repeat(64),
      sourceType: 'winget',
      installerType: 'exe',
      silentSwitches: '/headless',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:Toolbox:JetBrains Toolbox',
      installScope: 'user',
    }), config, { skipRunCapture: true });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(JSON.parse(payload.client_payload.config.psadtConfig))
      .toMatchObject({ reviewedUninstallArguments: ['/headless'] });
  });

  it('dispatches the reviewed Postgres Pro lifecycle through the customer packager', async () => {
    reconcileCatalogInstallerMock.mockImplementationOnce(async (item) => ({
      item: {
        ...item,
        uninstallCommand:
          'REGISTRY_UNINSTALL_KEY:PostgreSQL 17 (64bit):PostgreSQL 17 (64bit)',
      },
      trustedInstallers: [],
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(workflowInputs({
      wingetId: 'PostgresPro.Standard.17',
      displayName: 'Postgres Pro Standard 17',
      publisher: 'Postgres Professional',
      version: '17.7',
      installerSha256: 'A'.repeat(64),
      sourceType: 'winget',
      installerType: 'nullsoft',
      silentSwitches: '--mode unattended',
      uninstallCommand: 'REGISTRY_UNINSTALL:Postgres Pro Standard 17',
    }), config, { skipRunCapture: true });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.client_payload.installer.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_KEY:PostgreSQL 17 (64bit):PostgreSQL 17 (64bit)'
    );
    expect(JSON.parse(payload.client_payload.config.psadtConfig))
      .toMatchObject({ reviewedUninstallArguments: ['/S'] });
  });

  it('dispatches the observable Webroot MSI lifecycle through the customer packager', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(workflowInputs({
      wingetId: 'Webroot.SecureAnywhere',
      displayName: 'Webroot SecureAnywhere',
      publisher: 'Webroot',
      version: '9.0.45.63',
      architecture: 'x86',
      installerSha256: 'B'.repeat(64),
      sourceType: 'winget',
      installerType: 'msi',
      silentSwitches: '/qn /norestart ALLUSERS=1',
      uninstallCommand: 'REGISTRY_UNINSTALL:Webroot SecureAnywhere',
    }), config, { skipRunCapture: true });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.client_payload.installer.type).toBe('msi');
    expect(JSON.parse(payload.client_payload.config.psadtConfig)).toMatchObject({
      reviewedInstallCompletionTimeoutMinutes: 15,
    });
  });

  it('lets reconciliation strengthen a generated display-name uninstall fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(workflowInputs({
      wingetId: 'FinancialID.BankID',
      displayName: 'BankID säkerhetsprogram',
      installerSha256: 'A'.repeat(64),
      sourceType: 'winget',
      uninstallCommand: 'REGISTRY_UNINSTALL:BankID säkerhetsprogram',
    }), config, { skipRunCapture: true });

    const reconciledItem = reconcileCatalogInstallerMock.mock.calls[0][0];
    expect(reconciledItem.psadtConfig.uninstallCommand).toBeUndefined();
  });

  it('preserves a customer-provided uninstall override during reconciliation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(workflowInputs({
      wingetId: 'Example.App',
      installerSha256: 'A'.repeat(64),
      sourceType: 'winget',
      uninstallCommand: 'vendor-remover.exe /tenant-approved',
    }), config, { skipRunCapture: true });

    const reconciledItem = reconcileCatalogInstallerMock.mock.calls[0][0];
    expect(reconciledItem.psadtConfig.uninstallCommand).toBe(
      'vendor-remover.exe /tenant-approved'
    );
  });

  it('dispatches calculate mode for a custom installer without a trusted hash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(workflowInputs(), config, { skipRunCapture: true });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.client_payload.installer).toEqual(
      expect.objectContaining({
        sha256: '',
        hashValidationMode: 'calculate',
      })
    );
  });

  it('does not dispatch a custom plain EXE without silent switches', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(triggerPackagingWorkflow(workflowInputs({
      silentSwitches: '',
    }), config, { skipRunCapture: true })).rejects.toMatchObject({
      code: 'silent-install-contract-missing',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults to strict mode when no mode override is supplied', async () => {
    enforceInstallerPreflightMock.mockResolvedValueOnce({
      cacheKey: 'healthy-key',
      status: 'healthy',
      source: 'cache',
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(
      workflowInputs({
        installerSha256: 'a'.repeat(64),
        hashValidationMode: undefined,
      }),
      config,
      { skipRunCapture: true }
    );

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.client_payload.installer.hashValidationMode).toBe('strict');
  });

  it('dispatches only server-resolved dependency metadata and binds it to the QA profile', async () => {
    const dependency = {
      packageIdentifier: 'Microsoft.VCRedist.2015+.x64',
      version: '14.51.36210.0',
      architecture: 'x64' as const,
      installerUrl: 'https://aka.ms/vc14/vc_redist.x64.exe',
      installerSha256: 'B'.repeat(64),
      installerType: 'exe' as const,
      silentArgs: '/install /quiet /norestart',
      successCodes: [-2147023258, 0, 1638],
      rebootCodes: [1641, 3010],
      fileName: 'Microsoft.VCRedist.2015+.x64-vc_redist.x64.exe',
      order: 1,
      depth: 1,
    };
    resolveDependenciesMock.mockResolvedValueOnce([dependency]);
    vi.stubEnv('CALLBACK_SECRET', 'dependency-signing-secret');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(workflowInputs({
      wingetId: 'Oracle.VirtualBox',
      version: '7.2.14',
      installerSha256: 'A'.repeat(64),
      hashValidationMode: 'strict',
      sourceType: 'winget',
      packageDependencies: [],
    }), config, { skipRunCapture: true });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(JSON.parse(payload.client_payload.installer.packageDependencies)).toEqual([
      dependency,
    ]);
    expect(payload.client_payload.installer.dependencyBundleSignature).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(resolveDependenciesMock).toHaveBeenCalledWith(expect.objectContaining({
      wingetId: 'Oracle.VirtualBox',
      installerSha256: 'A'.repeat(64),
    }));
    expect(enforceQaGateMock).toHaveBeenCalledWith(expect.objectContaining({
      packageProfileSha256: expect.stringMatching(/^[A-F0-9]{64}$/),
    }));
  });

  it('dispatches the same reconciled marker rules that are used for the QA gate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const inputs = workflowInputs({
      wingetId: 'Asana.Asana',
      version: '2.8.0',
      installerSha256: 'A'.repeat(64),
      sourceType: 'winget',
      installScope: 'user',
      detectionRules: JSON.stringify([
        {
          type: 'registry',
          keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Asana_Asana',
          valueName: 'Version',
          detectionType: 'version',
          operator: 'greaterThanOrEqual',
          detectionValue: '2.7.1',
        },
      ]),
      psadtConfig: JSON.stringify({ brandingCompanyName: 'Contoso' }),
    });

    await triggerPackagingWorkflow(
      inputs,
      config,
      { skipRunCapture: true }
    );

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    const dispatchedRules = JSON.parse(payload.client_payload.config.detectionRules);
    const dispatchedConfig = JSON.parse(payload.client_payload.config.psadtConfig);

    expect(dispatchedRules[0]).toMatchObject({
      keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Asana_Asana',
      detectionValue: '2.8.0',
    });
    expect(dispatchedConfig).toMatchObject({
      brandingCompanyName: 'Contoso',
      detectionRules: dispatchedRules,
    });
    const dispatchedIdentity = buildQaPackageIdentityFromWorkflowInput({
      ...inputs,
      psadtConfig: payload.client_payload.config.psadtConfig,
      detectionRules: payload.client_payload.config.detectionRules,
    });
    expect(enforceQaGateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        packageProfileSha256: dispatchedIdentity.packageProfileSha256,
      })
    );
  });

  it('does not reconcile custom-installer detection rules', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const detectionRules = JSON.stringify([
      {
        type: 'registry',
        keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Custom_Example_App',
        valueName: 'Version',
        detectionType: 'version',
        operator: 'equal',
        detectionValue: '1.0.0',
      },
    ]);
    const psadtConfig = JSON.stringify({ detectionRules, brandingCompanyName: 'Custom' });

    await triggerPackagingWorkflow(
      workflowInputs({
        sourceType: 'custom',
        installScope: 'user',
        detectionRules,
        psadtConfig,
      }),
      config,
      { skipRunCapture: true }
    );

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.client_payload.config.detectionRules).toBe(detectionRules);
    expect(payload.client_payload.config.psadtConfig).toBe(psadtConfig);
  });

  it('does not call GitHub when installer preflight blocks dispatch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    enforceInstallerPreflightMock.mockRejectedValueOnce(new Error('quarantined'));

    await expect(triggerPackagingWorkflow(
      workflowInputs({
        wingetId: 'Example.App',
        installerSha256: 'a'.repeat(64),
        sourceType: 'winget',
      }),
      config,
      { skipRunCapture: true },
    )).rejects.toThrow('quarantined');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call GitHub when the final QA gate blocks dispatch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    enforceQaGateMock.mockRejectedValueOnce(new Error('known failed QA result'));

    await expect(triggerPackagingWorkflow(
      workflowInputs({ wingetId: 'Example.App', sourceType: 'winget' }),
      config,
      { skipRunCapture: true },
    )).rejects.toThrow('known failed QA result');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('binds a required QA pass to the dispatched installer SHA', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const sha = 'A'.repeat(64);
    await triggerPackagingWorkflow(
      workflowInputs({ wingetId: 'Example.App', installerSha256: sha, sourceType: 'winget' }),
      config,
      { skipRunCapture: true, requireQaPass: true }
    );
    expect(enforceQaGateMock).toHaveBeenCalledWith(
      expect.objectContaining({ installerSha256: sha, requirePassed: true })
    );
  });

  it('uses qaOverride only at the server gate and does not forward it to GitHub', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(workflowInputs({ qaOverride: true }), config, { skipRunCapture: true });

    expect(enforceQaGateMock).toHaveBeenCalledWith(expect.objectContaining({ qaOverride: true }));
    const payload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(JSON.stringify(payload)).not.toContain('qaOverride');
  });
});
