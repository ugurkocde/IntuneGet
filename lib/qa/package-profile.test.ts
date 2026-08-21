import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import { applyApplicationPackagingAdapter } from '@/lib/packaging-adapters';
import {
  buildQaPackageIdentity,
  buildQaPackageIdentityFromWorkflowInput,
  canonicalQaJson,
  normalizeQaWorkflowPackageInput,
  QA_COMPATIBLE_PASSED_PACKAGER_COMMITS,
  QA_PACKAGE_PROFILE_SCHEMA_VERSION,
  QA_PSADT_TOOLCHAIN,
  qaSha256,
  splitQaPsadtConfig,
  validateCompatiblePassedCatalogQaProfile,
  validateCompatiblePassedDeploymentQaProfile,
  validateCurrentQaPackageProfile,
} from './package-profile';

const input = {
  profileKind: 'catalog-default' as const,
  wingetId: 'Example.App',
  displayName: 'Example',
  publisher: 'Example Corp',
  version: '2.0.0',
  architecture: 'x64',
  installerSha256: 'a'.repeat(64),
  sourceInstallerType: 'inno',
  silentArgs: '/VERYSILENT',
  uninstallCommand: 'REGISTRY_UNINSTALL:Example',
  installScope: 'machine',
  nestedInstallerType: '',
  nestedInstallerFiles: [],
  psadtConfig: DEFAULT_PSADT_CONFIG,
  detectionRules: [],
};

describe('PSADT QA package identity', () => {
  it('canonicalizes object keys recursively', () => {
    expect(canonicalQaJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}'
    );
  });

  it('is stable for the same effective package inputs', () => {
    expect(buildQaPackageIdentity(input)).toEqual(buildQaPackageIdentity({ ...input }));
  });

  it('changes when a PSADT switch changes', () => {
    const changed = buildQaPackageIdentity({
      ...input,
      psadtConfig: { ...DEFAULT_PSADT_CONFIG, verifyInstall: true },
    });
    expect(changed.packageProfileSha256).not.toBe(
      buildQaPackageIdentity(input).packageProfileSha256
    );
    expect(changed.psadtConfigSha256).not.toBe(
      buildQaPackageIdentity(input).psadtConfigSha256
    );
  });

  it('reuses execution QA when only presentation changes', () => {
    const deploymentInput = { ...input, profileKind: 'deployment-config' as const };
    const baseline = buildQaPackageIdentity(deploymentInput);
    const branded = buildQaPackageIdentity({
      ...deploymentInput,
      displayName: 'Customer-facing Example',
      publisher: 'Customer Publisher',
      psadtConfig: {
        ...DEFAULT_PSADT_CONFIG,
        brandingCompanyName: 'Contoso',
        brandingWelcomeTitle: 'Install Example',
        brandingAccentColor: '#123456',
        progressDialog: {
          ...DEFAULT_PSADT_CONFIG.progressDialog,
          statusMessage: 'A customer-specific message',
          windowLocation: 'BottomRight',
        },
      },
    });

    expect(branded.executionProfileSha256).toBe(baseline.executionProfileSha256);
    expect(branded.packageProfileSha256).toBe(baseline.packageProfileSha256);
    expect(branded.presentationProfileSha256).not.toBe(
      baseline.presentationProfileSha256
    );
  });

  it('keeps interaction timing and custom command changes in the execution profile', () => {
    const baseline = buildQaPackageIdentity(input);
    const interactive = buildQaPackageIdentity({
      ...input,
      psadtConfig: {
        ...DEFAULT_PSADT_CONFIG,
        allowDefer: true,
        deferTimes: 5,
        postInstallCommands: ['echo verified'],
      },
    });

    expect(interactive.executionProfileSha256).not.toBe(
      baseline.executionProfileSha256
    );
  });

  it('changes when installer switches or detection rules change', () => {
    expect(
      buildQaPackageIdentity({ ...input, silentArgs: '/S' }).packageProfileSha256
    ).not.toBe(buildQaPackageIdentity(input).packageProfileSha256);
    expect(
      buildQaPackageIdentity({
        ...input,
        detectionRules: [
          {
            type: 'registry',
            keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Example',
            check32BitOn64System: false,
            detectionType: 'exists',
          },
        ],
      }).packageProfileSha256
    ).not.toBe(buildQaPackageIdentity(input).packageProfileSha256);
  });

  it('binds canonical-vs-deployment routing into the profile identity', () => {
    expect(
      buildQaPackageIdentity({ ...input, profileKind: 'deployment-config' })
        .packageProfileSha256
    ).not.toBe(buildQaPackageIdentity(input).packageProfileSha256);
  });

  it('hashes manifest-declared success exit codes without changing empty profiles', () => {
    const baseline = buildQaPackageIdentity(input);
    const withSuccessCode = buildQaPackageIdentity({ ...input, successCodes: [1168] });
    expect(withSuccessCode.packageProfileSha256).not.toBe(baseline.packageProfileSha256);
    expect(withSuccessCode.profile.installer).toMatchObject({ successCodes: [1168] });
    expect(buildQaPackageIdentity({ ...input, successCodes: [] })).toEqual(baseline);
  });

  it('binds the reviewed Movavi success code to deployment QA identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Movavi.MovaviPhotoFocus',
      displayName: 'Movavi Photo Focus',
      publisher: 'Movavi',
      version: '1.1.0',
      architecture: 'x86',
      installerSha256: 'b'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:Movavi Photo Focus',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      installer: { successCodes?: number[] };
    };

    expect(profile.installer.successCodes).toEqual([1223]);
  });

  it('binds offline dependency installers to the execution profile only when present', () => {
    const baseline = buildQaPackageIdentity(input);
    const dependency = {
      packageIdentifier: 'Microsoft.VCRedist.2015+.x64',
      version: '14.51.36210.0',
      architecture: 'x64' as const,
      installerUrl: 'https://aka.ms/vc14/vc_redist.x64.exe',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe' as const,
      silentArgs: '/install /quiet /norestart',
      successCodes: [-2147023258, 0, 1638],
      rebootCodes: [1641, 3010],
      fileName: 'Microsoft.VCRedist.2015+.x64-vc_redist.x64.exe',
      order: 1,
      depth: 1,
    };
    const withDependency = buildQaPackageIdentity({
      ...input,
      packageDependencies: [dependency],
    });
    const installer = withDependency.profile.installer as Record<string, unknown>;

    expect(withDependency.packageProfileSha256).not.toBe(
      baseline.packageProfileSha256
    );
    expect(installer.packageDependencies).toEqual([
      expect.objectContaining({
        packageIdentifier: dependency.packageIdentifier,
        sha256: dependency.installerSha256.toUpperCase(),
      }),
    ]);
    expect(installer.dependenciesSha256).toMatch(/^[A-F0-9]{64}$/);
    expect((baseline.profile.installer as Record<string, unknown>).packageDependencies)
      .toBeUndefined();
    expect(buildQaPackageIdentity({ ...input, packageDependencies: [] })).toEqual(baseline);
  });

  it('reconciles an IntuneGet marker with the current workflow scope and version', () => {
    const workflowInput = {
      wingetId: 'Asana.Asana',
      displayName: 'Asana',
      publisher: 'Asana',
      version: '2.8.0',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--silent',
      uninstallCommand: 'REGISTRY_UNINSTALL:Asana',
      installScope: 'user' as const,
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
      psadtConfig: JSON.stringify({
        detectionRules: [],
        brandingCompanyName: 'Contoso',
      }),
    };
    const normalized = normalizeQaWorkflowPackageInput(workflowInput);
    const identity = buildQaPackageIdentityFromWorkflowInput(workflowInput);
    const profile = identity.profile as {
      schemaVersion: number;
      detectionRules: Array<Record<string, unknown>>;
      psadtConfig: { detectionRules: Array<Record<string, unknown>> };
    };

    expect(profile.schemaVersion).toBe(QA_PACKAGE_PROFILE_SCHEMA_VERSION);
    expect(profile.detectionRules[0]).toMatchObject({
      keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Asana_Asana',
      detectionValue: '2.8.0',
    });
    expect(profile.psadtConfig.detectionRules).toEqual(profile.detectionRules);
    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject({
      brandingCompanyName: 'Contoso',
      detectionRules: profile.detectionRules,
    });
    expect(
      splitQaPsadtConfig(JSON.parse(normalized.psadtConfigJson)).execution
    ).toEqual(profile.psadtConfig);
  });

  it('repairs a legacy deployment profile that has no detection rules', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Anysphere.Cursor',
      displayName: 'Cursor',
      publisher: 'Anysphere',
      version: '3.14.27',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'inno',
      silentSwitches: '/VERYSILENT',
      uninstallCommand: 'REGISTRY_UNINSTALL:Cursor',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });

    expect(normalized.detectionRules).toEqual([
      expect.objectContaining({
        type: 'registry',
        keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Anysphere_Cursor',
        detectionValue: '3.14.27',
      }),
    ]);
    expect(JSON.parse(normalized.psadtConfigJson).detectionRules).toEqual(
      normalized.detectionRules
    );
  });

  it('restores a saved custom marker root before hashing the deployment profile', () => {
    const savedRule = {
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\HBX\\InstalledApps\\8x8_Work',
      valueName: 'Version',
      check32BitOn64System: false,
      detectionType: 'version',
      operator: 'greaterThanOrEqual',
      detectionValue: '8.36.2',
    };
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: '8x8.Work',
      displayName: '8x8.Work',
      publisher: 'IntuneGet QA',
      version: '8.36.2',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'wix',
      silentSwitches: '/qn /norestart',
      uninstallCommand: 'msiexec /x "{A92AC549-F4B9-4875-B02C-F51FA50A0F19}" /qn /norestart',
      installScope: 'machine',
      detectionRules: JSON.stringify([savedRule]),
      psadtConfig: JSON.stringify({ detectionRules: [savedRule] }),
    });
    const psadtConfig = JSON.parse(normalized.psadtConfigJson);

    expect(psadtConfig.registryMarkerPath).toBe('SOFTWARE\\HBX\\InstalledApps');
    expect(psadtConfig.detectionRules).toEqual(normalized.detectionRules);
    expect(normalized.detectionRules).toEqual([savedRule]);
    expect((normalized.identity.profile.psadtConfig as { registryMarkerPath?: string })
      .registryMarkerPath).toBe('SOFTWARE\\HBX\\InstalledApps');
  });

  it('repairs generated detection when a saved catalog profile changed from MSIX to MSI', () => {
    const staleMsixRule = {
      type: 'script',
      scriptContent: [
        '# MSIX Detection Script',
        '# Package Family Name: Agilebits.1Password_amwd9z03whsfe',
        'exit 0',
      ].join('\n'),
      enforceSignatureCheck: false,
      runAs32Bit: false,
    };
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'AgileBits.1Password',
      displayName: '1Password',
      publisher: 'AgileBits',
      version: '8.12.30.21',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'msi',
      silentSwitches: '/qn /norestart',
      uninstallCommand: 'msiexec /x "{598797D5-61EB-46AF-8F8B-0C2070B648A2}" /qn /norestart',
      installScope: 'machine',
      detectionRules: JSON.stringify([staleMsixRule]),
      psadtConfig: JSON.stringify({ detectionRules: [staleMsixRule] }),
    });

    expect(normalized.detectionRules).toEqual([expect.objectContaining({
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\AgileBits_1Password',
      detectionValue: '8.12.30.21',
    })]);
    expect(JSON.parse(normalized.psadtConfigJson).detectionRules).toEqual(
      normalized.detectionRules
    );
  });

  it('normalizes reviewed per-user apps before hashing deployment QA identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'VNGCorp.Zalo',
      displayName: 'Zalo',
      publisher: 'VNGCorp',
      version: '26.8.10',
      architecture: 'x86',
      installerSha256: 'b'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL_PRODUCT:{F0C47DE4-C117-54E4-97D9-EB3FD2985E6C}:Zalo',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { installScope: string };
    };

    expect(profile.installer.installScope).toBe('user');
    expect(normalized.detectionRules).toEqual([
      expect.objectContaining({
        keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\VNGCorp_Zalo',
      }),
    ]);
  });

  it('binds Logitech Presentation remote deployment to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Logitech.Presentation',
      displayName: 'Logitech Presentation',
      publisher: 'Logitech',
      version: '2.10.34',
      architecture: 'x86',
      installerSha256: 'b'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:LogiPresentation:Logitech Presentation',
      installScope: 'user',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { installScope: string };
      psadtConfig: { reviewedInstallArgumentsOverride?: string };
    };

    expect(profile.installer.installScope).toBe('machine');
    expect(profile.psadtConfig.reviewedInstallArgumentsOverride).toBe('/S /U:0 /A:0');
    expect(normalized.detectionRules).toEqual([
      expect.objectContaining({
        keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Logitech_Presentation',
      }),
    ]);
  });

  it('binds the reviewed Logitech G HUB lifecycle to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Logitech.GHUB',
      displayName: 'Logitech G HUB',
      publisher: 'Logitech',
      version: '2026.4.919028',
      architecture: 'x64',
      installerSha256: 'd'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--silent',
      uninstallCommand: 'REGISTRY_UNINSTALL:Logitech G HUB',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      psadtConfig: {
        processesToClose: Array<{ name: string }>;
        reviewedInstallCompletionTimeoutMinutes?: number;
        reviewedExactUninstall?: {
          executablePath: string;
          arguments: string[];
          completionTimeoutMinutes: number;
        };
      };
    };

    expect(profile.psadtConfig.processesToClose.map(({ name }) => name)).toEqual([
      'lghub',
      'lghub_agent',
      'lghub_updater',
      'lghub_software_manager',
    ]);
    expect(profile.psadtConfig.reviewedInstallCompletionTimeoutMinutes).toBe(15);
    expect(profile.psadtConfig.reviewedExactUninstall).toEqual({
      executablePath: '%ProgramFiles%\\LGHUB\\lghub_updater.exe',
      arguments: ['--uninstall', '--full'],
      completionTimeoutMinutes: 10,
    });
  });

  it('binds the bounded darktable installer wait to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'darktable.darktable',
      displayName: 'darktable',
      publisher: 'darktable',
      version: '5.6.0',
      architecture: 'x64',
      installerSha256: 'e'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:darktable:darktable',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { silentArgs: string; uninstallCommand: string };
      psadtConfig: { reviewedInstallCompletionTimeoutMinutes?: number };
    };

    expect(profile.psadtConfig.reviewedInstallCompletionTimeoutMinutes).toBe(15);
    expect(profile.installer.silentArgs).toBe('/S');
    expect(profile.installer.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_KEY:darktable:darktable'
    );
  });

  it('binds reviewed Wiris and Azure Monitor removal contracts to QA profiles', () => {
    const mathType = normalizeQaWorkflowPackageInput({
      wingetId: 'Wiris.MathType.7',
      displayName: 'MathType 7',
      publisher: 'Wiris',
      version: '7.12.2',
      architecture: 'x86',
      installerSha256: 'f'.repeat(64),
      installerType: 'exe',
      silentSwitches: '-Q',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:DSMT7:MathType 7',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const azureMonitor = normalizeQaWorkflowPackageInput({
      wingetId: 'Microsoft.AzureMonitorAgent',
      displayName: 'Azure Monitor Agent',
      publisher: 'Microsoft',
      version: '1.44.0.0',
      architecture: 'x64',
      installerSha256: 'a'.repeat(64),
      installerType: 'msi',
      silentSwitches: '/qn /norestart ALLUSERS=1',
      uninstallCommand:
        'msiexec /x "{C4F6939C-A3A2-4556-AEB6-889F720A8AB8}" /qn /norestart',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });

    expect(
      (mathType.identity.profile as {
        psadtConfig: { reviewedExactUninstall?: unknown };
      }).psadtConfig.reviewedExactUninstall
    ).toEqual({
      executablePath: '%ProgramFiles(x86)%\\MathType\\Setup.exe',
      arguments: ['-Q', '-R'],
      completionTimeoutMinutes: 5,
    });
    expect(
      (azureMonitor.identity.profile as {
        psadtConfig: { reviewedUninstallServiceNames?: string[] };
      }).psadtConfig.reviewedUninstallServiceNames
    ).toEqual(['AzureMonitorAgent']);
  });

  it('binds Logi Bolt to its exact /silent uninstaller', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Logitech.LogiBolt',
      displayName: 'Logi Bolt',
      publisher: 'Logitech',
      version: '1.2.6024.0',
      architecture: 'x64',
      installerSha256: '6'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/silent',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:LogiBolt:Logi Bolt',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });

    expect(
      (normalized.identity.profile as {
        psadtConfig: { reviewedExactUninstall?: unknown };
      }).psadtConfig.reviewedExactUninstall
    ).toEqual({
      executablePath: '%ProgramFiles%\\Logi\\LogiBolt\\LogiBoltUninstaller.exe',
      arguments: ['/silent'],
      completionTimeoutMinutes: 5,
    });
  });

  it('binds BlueJ to the documented explicit per-user MSI contract', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'BlueJTeam.BlueJ',
      displayName: 'BlueJ',
      publisher: 'BlueJTeam',
      version: '6.0.0',
      architecture: 'x64',
      installerSha256: '4'.repeat(64),
      installerType: 'msi',
      silentSwitches: '/qn /norestart ALLUSERS=2',
      uninstallCommand:
        'msiexec /x "{BAF3564F-5DE4-48AC-8CC4-260BFFD56D30}" /qn /norestart',
      installScope: 'user',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { installScope: string; silentArgs: string };
      psadtConfig: { reviewedInstallArgumentsOverride?: string };
    };

    expect(profile.installer.installScope).toBe('user');
    expect(profile.installer.silentArgs).toBe('/qn /norestart ALLUSERS=2');
    expect(profile.psadtConfig.reviewedInstallArgumentsOverride).toBe(
      '/qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=1 INSTALLDIR="%LOCALAPPDATA%\\Programs\\BlueJ"'
    );
  });

  it('binds the elevated NVM lifecycle to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'CoreyButler.NVMforWindows',
      displayName: 'NVM for Windows',
      publisher: 'CoreyButler',
      version: '1.2.2',
      architecture: 'x86',
      installerSha256: 'c'.repeat(64),
      installerType: 'inno',
      silentSwitches: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      uninstallCommand:
        'REGISTRY_UNINSTALL_KEY:40078385-F676-4C61-9A9C-F9028599D6D3_is1:NVM for Windows',
      installScope: 'user',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { installScope: string };
      psadtConfig: { reviewedInstallArgumentsOverride?: string };
    };

    expect(profile.installer.installScope).toBe('machine');
    expect(profile.psadtConfig.reviewedInstallArgumentsOverride).toBe(
      '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="%ProgramFiles%\\nvm"'
    );
    expect(normalized.detectionRules).toEqual([
      expect.objectContaining({
        keyPath:
          'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\CoreyButler_NVMforWindows',
      }),
    ]);
  });

  it('binds the reviewed Google Chrome EXE ARP identity to customer packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Google.Chrome.EXE',
      displayName: 'Google Chrome (EXE)',
      publisher: 'Google',
      version: '151.0.7922.76',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/silent /install',
      uninstallCommand: 'REGISTRY_UNINSTALL:Google Chrome (EXE)',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { uninstallCommand: string };
    };

    expect(normalized.uninstallCommand).toBe('REGISTRY_UNINSTALL:Google Chrome');
    expect(profile.installer.uninstallCommand).toBe('REGISTRY_UNINSTALL:Google Chrome');
  });

  it('binds Maestro 2025 embedded-MSI identity to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'MaestroSoft.MaestroAarsoppgjoer.2025',
      displayName: 'Maestro Årsoppgjør 2025',
      publisher: 'MaestroSoft',
      version: '38.05.21',
      architecture: 'x86',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/s',
      uninstallCommand: 'REGISTRY_UNINSTALL:Maestro Årsoppgjør 2025',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expected =
      'REGISTRY_UNINSTALL_PRODUCT:{20C36C0E-AF6D-4C46-AA1C-39080889BE9F}:Maestro Årsoppgjør 2025';
    const profile = normalized.identity.profile as {
      installer: { uninstallCommand: string };
    };

    expect(normalized.uninstallCommand).toBe(expected);
    expect(profile.installer.uninstallCommand).toBe(expected);
  });

  it('binds PTC Creo View Express to its published MSI identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'PTC.CreoView.Express',
      displayName: 'PTC Creo View Express',
      publisher: 'PTC',
      version: '20.0.0.0',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'zip',
      silentSwitches: '/v /quiet /norestart',
      uninstallCommand: 'REGISTRY_UNINSTALL:PTC Creo View Express',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expected =
      'REGISTRY_UNINSTALL_PRODUCT:{6DE7DB1D-27F7-46A8-AE3A-D8C2BB62870B}:PTC Creo View Express';
    const profile = normalized.identity.profile as {
      installer: { uninstallCommand: string };
      psadtConfig: { reviewedInstallArgumentsOverride?: string };
    };

    expect(normalized.uninstallCommand).toBe(expected);
    expect(profile.installer.uninstallCommand).toBe(expected);
    expect(profile.psadtConfig.reviewedInstallArgumentsOverride).toBe(
      '/vADDLOCAL="ALL" /qn /norestart'
    );
  });

  it('binds the Visual Studio 2017 instance lifecycle to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Microsoft.VisualStudio.2017.Enterprise',
      displayName: 'Visual Studio Enterprise 2017',
      publisher: 'Microsoft',
      version: '15.9.70',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--quiet --wait',
      uninstallCommand: 'REGISTRY_UNINSTALL:Visual Studio Enterprise 2017',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedPath =
      '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2017\\Enterprise';
    const expectedConfig = {
      reviewedManagedInstallDirectory: expectedPath,
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
        arguments: [
          'uninstall',
          '--installPath',
          expectedPath,
          '--quiet',
          '--norestart',
        ],
        completionTimeoutMinutes: 15,
      },
    };
    const profile = normalized.identity.profile as {
      psadtConfig: typeof expectedConfig;
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject(expectedConfig);
    expect(profile.psadtConfig).toMatchObject(expectedConfig);
  });

  it('binds the Visual Studio 2019 instance lifecycle to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Microsoft.VisualStudio.2019.BuildTools',
      displayName: 'Visual Studio BuildTools 2019',
      publisher: 'Microsoft',
      version: '16.11.59',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--quiet --wait --campaign "winget"',
      uninstallCommand: 'REGISTRY_UNINSTALL:Visual Studio BuildTools 2019',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedPath =
      '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2019\\BuildTools';
    const expectedConfig = {
      reviewedManagedInstallDirectory: expectedPath,
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
        arguments: [
          'uninstall',
          '--installPath',
          expectedPath,
          '--quiet',
          '--norestart',
        ],
        completionTimeoutMinutes: 15,
      },
    };
    const profile = normalized.identity.profile as {
      psadtConfig: typeof expectedConfig;
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject(expectedConfig);
    expect(profile.psadtConfig).toMatchObject(expectedConfig);
  });

  it('binds the Tor Browser extracted-folder lifecycle to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'TorProject.TorBrowser',
      displayName: 'Tor Browser',
      publisher: 'Tor Project',
      version: '15.0.19',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:Tor Browser',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedConfig = {
      reviewedManagedInstallDirectory: '%USERPROFILE%\\Desktop\\Tor Browser',
    };
    const profile = normalized.identity.profile as {
      installer: { installScope: string };
      psadtConfig: typeof expectedConfig;
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject(expectedConfig);
    expect(profile.installer.installScope).toBe('user');
    expect(profile.psadtConfig).toMatchObject(expectedConfig);
    expect(normalized.detectionRules).toEqual([
      expect.objectContaining({
        keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\TorProject_TorBrowser',
      }),
    ]);
  });

  it('binds the Speek non-ARP directory lifecycle to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Speek.Speek',
      displayName: 'Speek',
      publisher: 'Speek App',
      version: '1.7.0',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:Speek',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedConfig = {
      reviewedManagedInstallDirectory: '%ProgramFiles(x86)%\\Speek',
      reviewedManagedInstallEvidenceFile:
        '%ProgramFiles(x86)%\\Speek\\Speek.exe',
      reviewedManagedInstallCompletionTimeoutMinutes: 2,
    };
    const profile = normalized.identity.profile as {
      psadtConfig: typeof expectedConfig;
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject(expectedConfig);
    expect(profile.psadtConfig).toMatchObject(expectedConfig);
  });

  it('binds the Visual Studio 2022 Build Tools x86 instance root to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Microsoft.VisualStudio.2022.BuildTools',
      displayName: 'Visual Studio BuildTools 2022',
      publisher: 'Microsoft',
      version: '17.14.37',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--quiet --wait --campaign "winget"',
      uninstallCommand: 'REGISTRY_UNINSTALL:Visual Studio BuildTools 2022',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedPath =
      '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\BuildTools';
    const expectedConfig = {
      reviewedManagedInstallDirectory: expectedPath,
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
        arguments: [
          'uninstall',
          '--installPath',
          expectedPath,
          '--quiet',
          '--norestart',
        ],
        completionTimeoutMinutes: 15,
      },
    };
    const profile = normalized.identity.profile as {
      psadtConfig: typeof expectedConfig;
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject(expectedConfig);
    expect(profile.psadtConfig).toMatchObject(expectedConfig);
  });

  it('binds shared-runtime retention to both the normalized config and QA identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Microsoft.EdgeWebView2Runtime',
      displayName: 'Microsoft Edge WebView2 Runtime',
      publisher: 'Microsoft',
      version: '151.0.4129.78',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/silent /install',
      uninstallCommand: 'REGISTRY_UNINSTALL:Microsoft Edge WebView2 Runtime',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      psadtConfig: { preserveVendorInstallationOnUninstall?: boolean };
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject({
      preserveVendorInstallationOnUninstall: true,
    });
    expect(profile.psadtConfig.preserveVendorInstallationOnUninstall).toBe(true);
  });

  it('binds reviewed .NET Framework registry evidence to the QA identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Microsoft.DotNet.Framework.Runtime',
      displayName: 'Microsoft .NET Framework Runtime 4.8.1',
      publisher: 'Microsoft',
      version: '4.8.1',
      architecture: 'x64',
      installerSha256: 'c'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/passive /AcceptEULA /norestart',
      uninstallCommand:
        'REGISTRY_UNINSTALL:Microsoft .NET Framework Runtime 4.8.1',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedEvidence = {
      keyPath: 'HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full',
      valueName: 'Release',
      minimumDword: 533320,
    };
    const profile = normalized.identity.profile as {
      psadtConfig: {
        preserveVendorInstallationOnUninstall?: boolean;
        reviewedRegistryInstallEvidence?: typeof expectedEvidence;
      };
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject({
      preserveVendorInstallationOnUninstall: true,
      reviewedRegistryInstallEvidence: expectedEvidence,
    });
    expect(profile.psadtConfig.reviewedRegistryInstallEvidence).toEqual(
      expectedEvidence
    );
  });

  it('binds reviewed Windows App Runtime Appx evidence to the QA identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Microsoft.WindowsAppRuntime.1.8',
      displayName: 'Windows App Runtime 1.8',
      publisher: 'Microsoft',
      version: '1.8.9',
      architecture: 'x64',
      installerSha256: 'd'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--quiet',
      uninstallCommand: 'REGISTRY_UNINSTALL:Windows App Runtime 1.8',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedEvidence = {
      packageName: 'Microsoft.WindowsAppRuntime.1.8',
      publisherId: '8wekyb3d8bbwe',
      minimumVersion: '8000.879.2017.0',
    };
    const profile = normalized.identity.profile as {
      psadtConfig: {
        preserveVendorInstallationOnUninstall?: boolean;
        reviewedAppxInstallEvidence?: typeof expectedEvidence;
      };
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject({
      preserveVendorInstallationOnUninstall: true,
      reviewedAppxInstallEvidence: expectedEvidence,
    });
    expect(profile.psadtConfig.reviewedAppxInstallEvidence).toEqual(
      expectedEvidence
    );
  });

  it('preserves PSADT detection rules when the top-level workflow list is unusable', () => {
    const fileRule = {
      type: 'file' as const,
      path: '%ProgramFiles%\\Cursor',
      fileOrFolderName: 'Cursor.exe',
      detectionType: 'exists' as const,
    };
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Anysphere.Cursor',
      displayName: 'Cursor',
      publisher: 'Anysphere',
      version: '3.14.27',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'inno',
      silentSwitches: '/VERYSILENT',
      uninstallCommand: 'REGISTRY_UNINSTALL:Cursor',
      installScope: 'machine',
      detectionRules: '[{}]',
      psadtConfig: JSON.stringify({ detectionRules: [fileRule] }),
    });

    expect(normalized.detectionRules).toEqual([fileRule]);
    expect(JSON.parse(normalized.psadtConfigJson).detectionRules).toEqual([fileRule]);
  });
});

describe('current catalog QA package validation', () => {
  function candidateFromIdentity(identity: ReturnType<typeof buildQaPackageIdentity>) {
    const profile = identity.profile as {
      app: { wingetId: string; version: string; architecture: string };
      installer: { sha256: string };
    };
    return {
      testConfig: {
        profileKind: 'catalog-default',
        packageProfileCanonicalJson: identity.canonicalJson,
        packageProfileSha256: identity.packageProfileSha256,
      },
      candidatePackageProfileSha256: identity.packageProfileSha256,
      candidateWingetId: profile.app.wingetId,
      candidateVersion: profile.app.version,
      candidateArchitecture: profile.app.architecture,
      candidateInstallerSha256: profile.installer.sha256,
    };
  }

  function identityWithPackagerCommit(
    identity: ReturnType<typeof buildQaPackageIdentity>,
    packagerCommit: string
  ) {
    const profile = {
      ...identity.profile,
      toolchain: { ...QA_PSADT_TOOLCHAIN, packagerCommit },
    };
    const canonicalJson = canonicalQaJson(profile);
    const packageProfileSha256 = qaSha256(canonicalJson);
    return { ...identity, profile, canonicalJson, packageProfileSha256 };
  }

  function currentCandidate() {
    const identity = buildQaPackageIdentity(input);
    return {
      testConfig: {
        profileKind: 'catalog-default',
        packageProfileCanonicalJson: identity.canonicalJson,
        packageProfileSha256: identity.packageProfileSha256,
      },
      candidatePackageProfileSha256: identity.packageProfileSha256,
      candidateWingetId: input.wingetId,
      candidateVersion: input.version,
      candidateArchitecture: input.architecture,
      candidateInstallerSha256: input.installerSha256,
    };
  }

  it('accepts a fully current profile identity', () => {
    expect(validateCurrentQaPackageProfile(currentCandidate())).toMatchObject({
      valid: true,
    });
  });

  it('reuses an older catalog pass only when lifecycle behavior is unaffected', () => {
    const priorCommit = QA_COMPATIBLE_PASSED_PACKAGER_COMMITS.find(
      (commit) => commit !== QA_PSADT_TOOLCHAIN.packagerCommit
    );
    expect(priorCommit).toBeTruthy();
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity(input),
      priorCommit!
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toMatchObject({ valid: true });
  });

  it('does not reuse a process lifecycle pass from before the lifecycle release', () => {
    const priorCommit = 'c1fe66c04b11f595bfaf4c9ca7cc1444186ea028';
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({
        ...input,
        psadtConfig: {
          ...DEFAULT_PSADT_CONFIG,
          processesToClose: [{ name: 'Example', description: 'Example' }],
        },
      }),
      priorCommit
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toEqual({ valid: false, reason: 'compatible-process-lifecycle-changed' });
  });

  it('reuses a process lifecycle pass through later unrelated releases', () => {
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({
        ...input,
        psadtConfig: {
          ...DEFAULT_PSADT_CONFIG,
          processesToClose: [{ name: 'Example', description: 'Example' }],
        },
      }),
      '66448ea49841c2c9f3ebf56e455ce8797e2b2abb'
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toMatchObject({ valid: true });
  });

  it('retests only a profile that exercises the zero-day deferral branch', () => {
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({
        ...input,
        psadtConfig: {
          ...DEFAULT_PSADT_CONFIG,
          allowDefer: true,
          deferDays: 0,
        },
      }),
      '430f817da1120f6a14f421b7016b628a06854aba'
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toEqual({ valid: false, reason: 'compatible-zero-day-deferral-changed' });
  });

  it('retests a prior profile that needs target-machine install-location expansion', () => {
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({
        ...input,
        silentArgs: '/S --installpath="%PROGRAMFILES(X86)%\\Contoso"',
      }),
      'fbb4aa2eed6cc545ec343373dd8947d04463a4a1'
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toEqual({
      valid: false,
      reason: 'compatible-install-location-expansion-changed',
    });
  });

  it('reuses the same deployment execution profile across an unrelated packager release', () => {
    const currentIdentity = buildQaPackageIdentity({
      ...input,
      profileKind: 'deployment-config',
      psadtConfig: {
        ...DEFAULT_PSADT_CONFIG,
        processesToClose: [{ name: 'Example', description: 'Example' }],
      },
    });
    const priorIdentity = identityWithPackagerCommit(
      currentIdentity,
      '66448ea49841c2c9f3ebf56e455ce8797e2b2abb'
    );

    expect(validateCompatiblePassedDeploymentQaProfile({
      prior: {
        testConfig: {
          profileKind: 'deployment-config',
          packageProfileCanonicalJson: priorIdentity.canonicalJson,
          packageProfileSha256: priorIdentity.packageProfileSha256,
        },
        candidatePackageProfileSha256: priorIdentity.packageProfileSha256,
        candidateWingetId: input.wingetId,
        candidateVersion: input.version,
        candidateArchitecture: input.architecture,
        candidateInstallerSha256: input.installerSha256,
      },
      currentCanonicalJson: currentIdentity.canonicalJson,
      currentPackageProfileSha256: currentIdentity.packageProfileSha256,
    })).toMatchObject({ valid: true });
  });

  it('does not reuse a different deployment execution profile', () => {
    const currentIdentity = buildQaPackageIdentity({
      ...input,
      profileKind: 'deployment-config',
      psadtConfig: { ...DEFAULT_PSADT_CONFIG, deployMode: 'Auto' },
    });
    const priorIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({ ...input, profileKind: 'deployment-config' }),
      '66448ea49841c2c9f3ebf56e455ce8797e2b2abb'
    );

    expect(validateCompatiblePassedDeploymentQaProfile({
      prior: {
        testConfig: {
          profileKind: 'deployment-config',
          packageProfileCanonicalJson: priorIdentity.canonicalJson,
          packageProfileSha256: priorIdentity.packageProfileSha256,
        },
        candidatePackageProfileSha256: priorIdentity.packageProfileSha256,
        candidateWingetId: input.wingetId,
        candidateVersion: input.version,
        candidateArchitecture: input.architecture,
        candidateInstallerSha256: input.installerSha256,
      },
      currentCanonicalJson: currentIdentity.canonicalJson,
      currentPackageProfileSha256: currentIdentity.packageProfileSha256,
    })).toEqual({ valid: false, reason: 'compatible-execution-profile-changed' });
  });

  it('does not reuse an older pass when the current app adapter adds behavior', () => {
    const priorCommit = QA_COMPATIBLE_PASSED_PACKAGER_COMMITS.find(
      (commit) => commit !== QA_PSADT_TOOLCHAIN.packagerCommit
    )!;
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({
        ...input,
        wingetId: 'Elgato.StreamDeck',
      }),
      priorCommit
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toEqual({ valid: false, reason: 'compatible-application-adapter-changed' });
  });

  it('reuses an adapted pass when a later release leaves its behavior unchanged', () => {
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({
        ...input,
        wingetId: 'Google.GoogleDrive',
        psadtConfig: applyApplicationPackagingAdapter(
          'Google.GoogleDrive',
          DEFAULT_PSADT_CONFIG
        ),
      }),
      'ca77e52dc65a404eb81679c5188378bf4d69a692'
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toMatchObject({ valid: true });
  });

  it('normalizes case and whitespace on both sides of candidate bindings', () => {
    const identity = buildQaPackageIdentity(input);
    const profile = identity.profile as {
      app: Record<string, unknown>;
      installer: Record<string, unknown>;
    };
    const normalizedProfile = {
      ...profile,
      app: {
        ...profile.app,
        wingetId: ` ${input.wingetId.toUpperCase()} `,
        version: ` ${input.version} `,
        architecture: 'X64',
      },
      installer: {
        ...profile.installer,
        sha256: input.installerSha256.toLowerCase(),
      },
    };
    const canonicalJson = canonicalQaJson(normalizedProfile);
    const hash = qaSha256(canonicalJson);

    expect(
      validateCurrentQaPackageProfile({
        ...currentCandidate(),
        testConfig: {
          profileKind: 'catalog-default',
          packageProfileCanonicalJson: canonicalJson,
          packageProfileSha256: hash,
        },
        candidatePackageProfileSha256: hash.toLowerCase(),
        candidateWingetId: ` ${input.wingetId.toLowerCase()} `,
        candidateVersion: ` ${input.version} `,
        candidateArchitecture: ' x64 ',
        candidateInstallerSha256: ` ${input.installerSha256.toLowerCase()} `,
      })
    ).toMatchObject({ valid: true });
  });

  it('hashes the stored JSON bytes without re-serializing them', () => {
    const identity = buildQaPackageIdentity(input);
    const nonCanonicalJson = JSON.stringify(identity.profile);
    const hash = qaSha256(nonCanonicalJson);
    expect(
      validateCurrentQaPackageProfile({
        testConfig: {
          profileKind: 'catalog-default',
          packageProfileCanonicalJson: nonCanonicalJson,
          packageProfileSha256: hash,
        },
        candidatePackageProfileSha256: hash,
        candidateWingetId: input.wingetId,
        candidateVersion: input.version,
        candidateArchitecture: input.architecture,
        candidateInstallerSha256: input.installerSha256,
      })
    ).toMatchObject({ valid: true, packageProfileSha256: hash });
  });

  it.each([
    ['profileKind', 'wrong-profile-kind'],
    ['packageProfileCanonicalJson', 'canonical-json-missing'],
    ['packageProfileSha256', 'config-profile-sha-invalid'],
  ])('rejects an invalid %s', (field, reason) => {
    const candidate = currentCandidate();
    delete candidate.testConfig[field as keyof typeof candidate.testConfig];
    expect(validateCurrentQaPackageProfile(candidate)).toEqual({ valid: false, reason });
  });

  it('rejects malformed canonical JSON', () => {
    const candidate = currentCandidate();
    candidate.testConfig.packageProfileCanonicalJson = '{';
    expect(validateCurrentQaPackageProfile(candidate)).toEqual({
      valid: false,
      reason: 'canonical-json-invalid',
    });
  });

  it('rejects independent config and candidate hash mismatches', () => {
    const configMismatch = currentCandidate();
    configMismatch.testConfig.packageProfileSha256 = 'B'.repeat(64);
    expect(validateCurrentQaPackageProfile(configMismatch)).toEqual({
      valid: false,
      reason: 'config-profile-sha-mismatch',
    });

    const candidateMismatch = currentCandidate();
    candidateMismatch.candidatePackageProfileSha256 = 'B'.repeat(64);
    expect(validateCurrentQaPackageProfile(candidateMismatch)).toEqual({
      valid: false,
      reason: 'candidate-profile-sha-mismatch',
    });
  });

  it('accepts a current deployment-config profile', () => {
    const identity = buildQaPackageIdentity({ ...input, profileKind: 'deployment-config' });
    expect(
      validateCurrentQaPackageProfile({
        testConfig: {
          profileKind: 'deployment-config',
          packageProfileCanonicalJson: identity.canonicalJson,
          packageProfileSha256: identity.packageProfileSha256,
        },
        candidatePackageProfileSha256: identity.packageProfileSha256,
        candidateWingetId: input.wingetId,
        candidateVersion: input.version,
        candidateArchitecture: input.architecture,
        candidateInstallerSha256: input.installerSha256,
      })
    ).toMatchObject({ valid: true });
  });

  it('rejects a missing test config and an invalid candidate hash', () => {
    const candidate = currentCandidate();
    expect(
      validateCurrentQaPackageProfile({ ...candidate, testConfig: null })
    ).toEqual({ valid: false, reason: 'test-config-invalid' });
    expect(
      validateCurrentQaPackageProfile({
        ...candidate,
        candidatePackageProfileSha256: 'not-a-hash',
      })
    ).toEqual({ valid: false, reason: 'candidate-profile-sha-invalid' });
  });

  it.each([
    ['schemaVersion', QA_PACKAGE_PROFILE_SCHEMA_VERSION + 1, 'canonical-schema-version-mismatch'],
    ['testLevel', 'other', 'canonical-test-level-mismatch'],
    ['profileKind', 'deployment-config', 'canonical-profile-kind-mismatch'],
    ['toolchain', null, 'toolchain-missing'],
  ])('rejects canonical %s inconsistency', (field, value, reason) => {
    const identity = buildQaPackageIdentity(input);
    const profile = { ...identity.profile, [field]: value };
    const canonicalJson = canonicalQaJson(profile);
    const hash = qaSha256(canonicalJson);
    expect(
      validateCurrentQaPackageProfile({
        testConfig: {
          profileKind: 'catalog-default',
          packageProfileCanonicalJson: canonicalJson,
          packageProfileSha256: hash,
        },
        candidatePackageProfileSha256: hash,
        candidateWingetId: input.wingetId,
        candidateVersion: input.version,
        candidateArchitecture: input.architecture,
        candidateInstallerSha256: input.installerSha256,
      })
    ).toEqual({ valid: false, reason });
  });

  it.each([
    ['candidateWingetId', 'Different.App', 'candidate-winget-id-mismatch'],
    ['candidateVersion', '9.9.9', 'candidate-version-mismatch'],
    ['candidateArchitecture', 'x86', 'candidate-architecture-mismatch'],
    ['candidateInstallerSha256', 'B'.repeat(64), 'candidate-installer-sha-mismatch'],
  ])('binds %s to the canonical profile', (field, value, reason) => {
    const candidate = currentCandidate();
    candidate[field as keyof typeof candidate] = value as never;
    expect(validateCurrentQaPackageProfile(candidate)).toEqual({ valid: false, reason });
  });

  it.each(Object.keys(QA_PSADT_TOOLCHAIN))(
    'rejects a mismatch in toolchain field %s',
    (field) => {
      const identity = buildQaPackageIdentity(input);
      const profile = {
        ...identity.profile,
        toolchain: {
          ...QA_PSADT_TOOLCHAIN,
          [field]: 'stale-value',
        },
      };
      const canonicalJson = canonicalQaJson(profile);
      const hash = qaSha256(canonicalJson);
      expect(
        validateCurrentQaPackageProfile({
          testConfig: {
            profileKind: 'catalog-default',
            packageProfileCanonicalJson: canonicalJson,
            packageProfileSha256: hash,
          },
          candidatePackageProfileSha256: hash,
          candidateWingetId: input.wingetId,
          candidateVersion: input.version,
          candidateArchitecture: input.architecture,
          candidateInstallerSha256: input.installerSha256,
        })
      ).toEqual({ valid: false, reason: `toolchain-mismatch:${field}` });
    }
  );

  it.each([
    ['psadtConfigSha256', 'canonical-psadt-config-sha-mismatch'],
    ['detectionRulesSha256', 'canonical-detection-rules-sha-mismatch'],
  ])('rejects an inconsistent embedded %s', (field, reason) => {
    const identity = buildQaPackageIdentity(input);
    const profile = { ...identity.profile, [field]: 'B'.repeat(64) };
    const canonicalJson = canonicalQaJson(profile);
    const hash = qaSha256(canonicalJson);

    expect(
      validateCurrentQaPackageProfile({
        ...currentCandidate(),
        testConfig: {
          profileKind: 'catalog-default',
          packageProfileCanonicalJson: canonicalJson,
          packageProfileSha256: hash,
        },
        candidatePackageProfileSha256: hash,
      })
    ).toEqual({ valid: false, reason });
  });
});
