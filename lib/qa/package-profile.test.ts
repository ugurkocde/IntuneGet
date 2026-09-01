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
    const withSuccessCode = buildQaPackageIdentity({
      ...input,
      successCodes: [1168, 3221225477, 3221226505],
    });
    expect(withSuccessCode.packageProfileSha256).not.toBe(baseline.packageProfileSha256);
    expect(withSuccessCode.profile.installer).toMatchObject({
      successCodes: [-1073741819, -1073740791, 1168],
    });
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

  it('binds JetBrains Toolbox customer packages to headless removal', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'JetBrains.Toolbox',
      displayName: 'JetBrains Toolbox',
      publisher: 'JetBrains',
      version: '3.7.2.0',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/headless',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:Toolbox:JetBrains Toolbox',
      installScope: 'user',
    });
    const profile = normalized.identity.profile as {
      psadtConfig: { reviewedUninstallArguments?: string[] };
    };

    expect(profile.psadtConfig.reviewedUninstallArguments).toEqual(['/headless']);
    expect(JSON.parse(normalized.psadtConfigJson).reviewedUninstallArguments)
      .toEqual(['/headless']);
  });

  it('binds Total Commander customer and QA packages to unattended removal', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Ghisler.TotalCommander',
      displayName: 'Total Commander',
      publisher: 'Ghisler',
      version: '11.58',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/AHN*',
      uninstallCommand:
        'REGISTRY_UNINSTALL_KEY:Totalcmd64:Total Commander 64-bit (Remove or Repair)',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      psadtConfig: { reviewedUninstallArguments?: string[] };
    };

    expect(profile.psadtConfig.reviewedUninstallArguments).toEqual(['/7']);
    expect(JSON.parse(normalized.psadtConfigJson).reviewedUninstallArguments)
      .toEqual(['/7']);
  });

  it('binds legacy Poly Lens packages to the renamed Poly Studio ARP identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Poly.PolyLens',
      displayName: 'Poly Lens',
      publisher: 'Poly',
      version: '5.1.0.1111',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'wix',
      silentSwitches: '/qn /norestart ALLUSERS=1',
      uninstallCommand:
        'msiexec /x "{50E3D49D-AAA9-45B6-B16E-ED99645C8B71}" /qn /norestart',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      psadtConfig: { reviewedRegistryUninstallDisplayName?: string };
    };

    expect(profile.psadtConfig.reviewedRegistryUninstallDisplayName)
      .toBe('Poly Studio');
    expect(JSON.parse(normalized.psadtConfigJson).reviewedRegistryUninstallDisplayName)
      .toBe('Poly Studio');
  });

  it('binds Jamovi customer and QA packages to the observed jamovi ARP identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Jamovi.Desktop.Current',
      displayName: 'Jamovi Desktop',
      publisher: 'Jamovi',
      version: '2.7.18.0',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:Jamovi Desktop',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      psadtConfig: { reviewedRegistryUninstallDisplayName?: string };
    };

    expect(profile.psadtConfig.reviewedRegistryUninstallDisplayName).toBe('jamovi');
    expect(JSON.parse(normalized.psadtConfigJson).reviewedRegistryUninstallDisplayName)
      .toBe('jamovi');
  });

  it('binds AionUi Community customer and QA packages to the upstream AionUi ARP identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Lumysia.AionUiCommunity',
      displayName: 'AionUi Community',
      publisher: 'Lumysia',
      version: '2.1.53',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:AionUi Community',
      installScope: 'user',
    });
    const profile = normalized.identity.profile as {
      psadtConfig: { reviewedRegistryUninstallDisplayName?: string };
    };

    expect(profile.psadtConfig.reviewedRegistryUninstallDisplayName).toBe('AionUi');
    expect(JSON.parse(normalized.psadtConfigJson).reviewedRegistryUninstallDisplayName)
      .toBe('AionUi');
  });

  it('binds QTTabBar customer and QA packages to the observed nested-MSI ARP identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'indiff.QTTabBar',
      displayName: 'QTTabBar',
      publisher: 'indiff',
      version: '1.5.6-beta.1',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'zip',
      silentSwitches: '/qn /norestart ALLUSERS=1',
      uninstallCommand: 'REGISTRY_UNINSTALL:QTTabBar',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      psadtConfig: { reviewedRegistryUninstallDisplayName?: string };
    };

    expect(profile.psadtConfig.reviewedRegistryUninstallDisplayName)
      .toBe('QTTabBar 1.5.6.1 Beta(2024)');
    expect(JSON.parse(normalized.psadtConfigJson).reviewedRegistryUninstallDisplayName)
      .toBe('QTTabBar 1.5.6.1 Beta(2024)');
  });

  it('binds IrfanView customer and QA packages to the documented silent uninstall', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'IrfanSkiljan.IrfanView',
      displayName: 'IrfanView',
      publisher: 'Irfan Skiljan',
      version: '4.75',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/silent /desktop=1 /group=1 /allusers=1',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:IrfanView64:IrfanView',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      psadtConfig: { reviewedUninstallArguments?: string[] };
    };

    expect(profile.psadtConfig.reviewedUninstallArguments).toEqual(['/silent']);
    expect(JSON.parse(normalized.psadtConfigJson).reviewedUninstallArguments)
      .toEqual(['/silent']);
  });

  it('binds Postgres Pro 17 customer packages to the exact vendor lifecycle', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'PostgresPro.Standard.17',
      displayName: 'Postgres Pro Standard 17',
      publisher: 'Postgres Professional',
      version: '17.7',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '--mode unattended',
      uninstallCommand: 'REGISTRY_UNINSTALL:Postgres Pro Standard 17',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      installer: { uninstallCommand: string };
      psadtConfig: { reviewedUninstallArguments?: string[] };
    };

    expect(normalized.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_KEY:PostgreSQL 17 (64bit):PostgreSQL 17 (64bit)'
    );
    expect(profile.installer.uninstallCommand).toBe(normalized.uninstallCommand);
    expect(profile.psadtConfig.reviewedUninstallArguments).toEqual(['/S']);
    expect(JSON.parse(normalized.psadtConfigJson).reviewedUninstallArguments)
      .toEqual(['/S']);
  });

  it('binds Quassel customer and QA packages to the exact NSIS registry identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Quassel.QuasselIRC',
      displayName: 'QuasselIRC',
      publisher: 'Quassel Project',
      version: '0.14.0',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:QuasselIRC',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      installer: { uninstallCommand: string };
    };

    expect(normalized.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_KEY:Quassel IRC:Quassel IRC'
    );
    expect(profile.installer.uninstallCommand).toBe(normalized.uninstallCommand);
  });

  it('binds G.SKILL Trident Z customer and QA packages to one exact Inno key', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'GSKILL.TridentZLightingControl',
      displayName: 'G.SKILL Trident Z Lighting Control',
      publisher: 'GSKILL',
      version: '1.00.38',
      architecture: 'x86',
      installerSha256: 'b'.repeat(64),
      installerType: 'zip',
      silentSwitches: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      uninstallCommand: 'REGISTRY_UNINSTALL:G.SKILL Trident Z Lighting Control',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      installer: { uninstallCommand: string };
    };

    expect(normalized.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_KEY:{97CD7AFC-0ED3-41B8-9CCD-22717E8631D0}_is1:Trident Z Lighting Control'
    );
    expect(profile.installer.uninstallCommand).toBe(normalized.uninstallCommand);
  });

  it('binds IDM reviewed window automation to customer and QA package identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Tonec.InternetDownloadManager',
      displayName: 'Internet Download Manager',
      publisher: 'Tonec Inc.',
      version: '6.43.10',
      architecture: 'x86',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/skipdlgs',
      uninstallCommand: 'REGISTRY_UNINSTALL:Internet Download Manager',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      psadtConfig: {
        reviewedUninstallArguments?: string[];
        reviewedUninstallWindowAutomation?: unknown;
      };
    };
    const expected = {
      processName: 'Uninstall.exe',
      steps: [
        {
          windowText: 'Internet Download Manager',
          buttonIndex: 2,
          timeoutSeconds: 60,
        },
        { buttonIndex: 3, timeoutSeconds: 15 },
        {
          windowText: 'Internet protocol options',
          buttonIndex: 2,
          timeoutSeconds: 15,
        },
      ],
    };

    expect(profile.psadtConfig.reviewedUninstallArguments).toEqual([]);
    expect(profile.psadtConfig.reviewedUninstallWindowAutomation).toEqual(expected);
    expect(
      JSON.parse(normalized.psadtConfigJson).reviewedUninstallWindowAutomation
    ).toEqual(expected);
  });

  it('binds FSLogix restart suppression to customer and QA package identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Microsoft.FSLogix',
      displayName: 'FSLogix',
      publisher: 'Microsoft',
      version: '3.26.126.19110',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'zip',
      nestedInstallerType: 'exe',
      nestedInstallerPath: 'x64\\Release\\FSLogixAppsSetup.exe',
      silentSwitches: '/install /quiet /norestart',
      uninstallCommand: 'REGISTRY_UNINSTALL:Microsoft FSLogix Apps',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      installer: { uninstallCommand: string };
      psadtConfig: { reviewedUninstallArguments?: string[] };
    };

    expect(normalized.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL:Microsoft FSLogix Apps'
    );
    expect(profile.installer.uninstallCommand).toBe(normalized.uninstallCommand);
    expect(profile.psadtConfig.reviewedUninstallArguments).toEqual([
      '/norestart',
    ]);
    expect(JSON.parse(normalized.psadtConfigJson).reviewedUninstallArguments)
      .toEqual(['/norestart']);
  });

  it('binds Chrome Beta EXE customer and QA profiles to the vendor channel key', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Google.Chrome.Beta.EXE',
      displayName: 'Google Chrome Beta (EXE)',
      publisher: 'Google',
      version: '152.0.7977.54',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--do-not-launch-chrome --system-level --chrome-beta',
      uninstallCommand:
        'REGISTRY_UNINSTALL_KEY:Google Chrome:Google Chrome Beta (EXE)',
      installScope: 'machine',
    });
    const profile = normalized.identity.profile as {
      installer: { uninstallCommand: string };
    };

    expect(normalized.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_KEY:Google Chrome Beta:Google Chrome Beta'
    );
    expect(profile.installer.uninstallCommand).toBe(normalized.uninstallCommand);
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

  it('normalizes zyfun to the same all-users customer and QA identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'HiramWong.zyfun',
      displayName: 'zyfun',
      publisher: 'HiramWong',
      version: '3.4.7',
      architecture: 'x64',
      installerSha256: '5'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:{1CF4E394-3CB1-57F9-A0E2-D9ADD46AD139}:zyfun',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { installScope: string; silentArgs: string };
      psadtConfig: { reviewedInstallArguments?: string[] };
    };

    expect(profile.installer.installScope).toBe('machine');
    expect(profile.installer.silentArgs).toBe('/S');
    expect(profile.psadtConfig.reviewedInstallArguments).toEqual(['/allusers']);
    expect(normalized.detectionRules).toEqual([
      expect.objectContaining({
        keyPath:
          'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\HiramWong_zyfun',
      }),
    ]);
  });

  it('keeps ElegantClipboard out of LocalSystem when WinGet omits its scope', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Y-ASLant.ElegantClipboard',
      displayName: 'ElegantClipboard',
      publisher: 'Y-ASLant',
      version: '1.2.7',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:ElegantClipboard',
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
        keyPath:
          'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Y_ASLant_ElegantClipboard',
      }),
    ]);
  });

  it('keeps Luniq out of LocalSystem when WinGet omits its scope', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'saraansx.Luniq',
      displayName: 'Luniq',
      publisher: 'saraansx',
      version: '2.0.1',
      architecture: 'x64',
      installerSha256: 'c'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:{75473D6D-5D57-5DE9-A4C2-E43CA90D272C}:Luniq',
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
        keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\saraansx_Luniq',
      }),
    ]);
  });

  it('keeps Android Apps Manager out of LocalSystem when WinGet omits its scope', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'SIMSDEV.AndroidAppsManager',
      displayName: 'Android Apps Manager',
      publisher: 'SIMSDEV',
      version: '0.1.0',
      architecture: 'x64',
      installerSha256: 'c'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:Android Apps Manager',
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
        keyPath:
          'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\SIMSDEV_AndroidAppsManager',
      }),
    ]);
  });

  it('keeps WowUp Beta out of LocalSystem when WinGet omits its scope', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'WowUp.Wowup.Beta',
      displayName: 'WowUp',
      publisher: 'WowUp',
      version: '2.21.0-beta.6',
      architecture: 'x64',
      installerSha256: 'c'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:{B31CA559-50E4-54D8-A458-330E72A28314}:WowUp',
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
        keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\WowUp_Wowup_Beta',
      }),
    ]);
  });

  it('keeps Switchbar out of LocalSystem when WinGet omits its scope', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'WebCatalogLtd.Switchbar',
      displayName: 'Switchbar',
      publisher: 'WebCatalog Ltd',
      version: '32.6.0',
      architecture: 'x86',
      installerSha256: 'c'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:{B130AB35-9C9C-5FEC-A754-546F900521F2}:Switchbar',
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
        keyPath:
          'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\WebCatalogLtd_Switchbar',
      }),
    ]);
  });

  it('keeps Somiibo out of LocalSystem when WinGet omits its scope', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'ITWCreativeWorks.Somiibo',
      displayName: 'Somiibo',
      publisher: 'ITWCreativeWorks',
      version: '1.2.32',
      architecture: 'x64',
      installerSha256: '3'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:Somiibo',
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
        keyPath:
          'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\ITWCreativeWorks_Somiibo',
      }),
    ]);
  });

  it('keeps SeqLens out of LocalSystem when WinGet omits its scope', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'SeqLens.SeqLens',
      displayName: 'SeqLens',
      publisher: 'SeqLens',
      version: '26.13.1',
      architecture: 'x64',
      installerSha256: 'd'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:{30843803-C83D-591B-931A-DD9E4FBAA77C}:SeqLens',
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
        keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\SeqLens_SeqLens',
      }),
    ]);
  });

  it('keeps SeaMeet Snap Recorder out of LocalSystem when WinGet omits its scope', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'SeasaltAI.SeaMeetSnapRecorder',
      displayName: 'SeaMeet Snap Recorder',
      publisher: 'SeasaltAI',
      version: '3.6.2',
      architecture: 'x64',
      installerSha256: 'e'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:5fd06921-7b39-5610-a9f4-36171cefce37:SeaMeet Snap Recorder',
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
        keyPath:
          'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\SeasaltAI_SeaMeetSnapRecorder',
      }),
    ]);
  });

  it('keeps Zoho Mail out of LocalSystem while retaining its machine-labelled installer', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Zoho.Mail',
      displayName: 'Zoho Mail - Desktop',
      publisher: 'Zoho',
      version: '1.10.3',
      architecture: 'x64',
      installerSha256: 'f'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:{435BDA16-99FD-51D0-938D-C156968A2AA4}:Zoho Mail - Desktop',
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
        keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Zoho_Mail',
      }),
    ]);
  });

  it('keeps BarryCarlyon Extension Tools out of LocalSystem while retaining its machine-labelled installer', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'BarryCarlyon.BarryCarlyonExtensionTools',
      displayName: 'BarryCarlyon Extension Tools',
      publisher: 'BarryCarlyon',
      version: '1.4.0',
      architecture: 'x64',
      installerSha256: 'a'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:BarryCarlyon Extension Tools',
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
        keyPath:
          'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\BarryCarlyon_BarryCarlyonExtensionTools',
      }),
    ]);
  });

  it('keeps FightPlanner out of LocalSystem while retaining its machine-labelled installer', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'ShatteredChaos.FightPlanner',
      displayName: 'FightPlanner',
      publisher: 'ShatteredChaos',
      version: '3.3.33',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:FightPlanner',
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
        keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\ShatteredChaos_FightPlanner',
      }),
    ]);
  });

  it('keeps Brity Meeting out of LocalSystem when WinGet omits its scope', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'SamsungSDS.BrityMeeting',
      displayName: 'Brity Meeting',
      publisher: 'SamsungSDS',
      version: '2.7.26.07281',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '-s',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:SamsungBrityMeeting:Brity Meeting',
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
        keyPath:
          'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\SamsungSDS_BrityMeeting',
      }),
    ]);
  });

  it('binds MiKTeX to its documented unattended integrated setup lifecycle', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'MiKTeX.MiKTeX',
      displayName: 'MiKTeX',
      publisher: 'MiKTeX',
      version: '25.12',
      architecture: 'x64',
      installerSha256: 'c'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--unattended --shared',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:MiKTeX:MiKTeX',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      psadtConfig: {
        reviewedExactUninstall?: {
          executablePath: string;
          arguments: string[];
          completionTimeoutMinutes: number;
        };
      };
    };

    expect(profile.psadtConfig.reviewedExactUninstall).toEqual({
      executablePath:
        '%ProgramFiles%\\MiKTeX\\miktex\\bin\\x64\\miktexsetup.exe',
      arguments: ['--quiet', '--shared=yes', 'uninstall'],
      completionTimeoutMinutes: 15,
    });
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

  it('binds WatchBP Analyzer elevation handling to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Microlife.WatchBPAnalyzer',
      displayName: 'WatchBP Analyzer',
      publisher: 'Microlife',
      version: '1.7.3.1',
      architecture: 'x64',
      installerSha256: 'a'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:WatchBP Analyzer:WatchBP Analyzer',
      installScope: 'user',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { installScope: string; silentArgs: string };
    };

    expect(profile.installer.installScope).toBe('machine');
    expect(profile.installer.silentArgs).toBe('/S');
    expect(normalized.detectionRules).toEqual([
      expect.objectContaining({
        keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Microlife_WatchBPAnalyzer',
      }),
    ]);
  });

  it('binds ReceitanetBX silent removal to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'ReceitaFederaldoBrasil.ReceitanetBX',
      displayName: 'Receitanet BX',
      publisher: 'Receita Federal do Brasil',
      version: '1.10.0',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/mode silent',
      uninstallCommand:
        'REGISTRY_UNINSTALL_KEY:EC016E3C-26D1-4DC8-9D8A-6AC06B3005A5:Receitanet BX',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      psadtConfig: { reviewedUninstallArguments?: string[] };
    };

    expect(profile.psadtConfig.reviewedUninstallArguments).toEqual(['/mode', 'silent']);
    expect(JSON.parse(normalized.psadtConfigJson).reviewedUninstallArguments)
      .toEqual(['/mode', 'silent']);
  });

  it('binds Logitech LGS to LocalSystem while retaining its catalog installer contract', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Logitech.LGS',
      displayName: 'Logitech Gaming Software',
      publisher: 'Logitech',
      version: '9.04.49',
      architecture: 'x64',
      installerSha256: 'c'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand:
        'REGISTRY_UNINSTALL_KEY:Logitech Gaming Software:Logitech Gaming Software',
      installScope: 'user',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { installScope: string; silentArgs: string };
      psadtConfig: {
        reviewedInstallArgumentsOverride?: string;
        reviewedExactUninstall?: {
          executablePath: string;
          arguments: string[];
          completionTimeoutMinutes: number;
        };
      };
    };

    expect(profile.installer.installScope).toBe('machine');
    expect(profile.installer.silentArgs).toBe('/S');
    expect(profile.psadtConfig.reviewedInstallArgumentsOverride).toBeUndefined();
    expect(profile.psadtConfig.reviewedExactUninstall).toEqual({
      executablePath:
        '%ProgramFiles%\\Logitech Gaming Software\\uninstallhlpr.exe',
      arguments: [
        '/bitness=x64',
        '/silentmode=on',
        '/langid=ENU',
        '/downgrade=no',
        '/firstRun=yes',
        '/S',
      ],
      completionTimeoutMinutes: 5,
    });
    expect(normalized.detectionRules).toEqual([
      expect.objectContaining({
        keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Logitech_LGS',
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

  it('binds the reviewed Autodesk Desktop Connector ODIS wait to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Autodesk.DesktopConnector',
      displayName: 'Autodesk Desktop Connector',
      publisher: 'Autodesk',
      version: '2027.2.0.85',
      architecture: 'x64',
      installerSha256: 'f'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--quiet',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:{0D3EBA46-5179-3ECC-9E63-8A0221EBFA9F}:Autodesk Desktop Connector',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { uninstallCommand: string };
      psadtConfig: {
        processesToClose: Array<{ name: string }>;
        reviewedInstallCompletionTimeoutMinutes?: number;
      };
    };

    expect(profile.psadtConfig.processesToClose.map(({ name }) => name)).toEqual([
      'DesktopConnector.Applications.Tray',
    ]);
    expect(profile.psadtConfig.reviewedInstallCompletionTimeoutMinutes).toBe(15);
    expect(profile.installer.uninstallCommand).toContain(
      '{0D3EBA46-5179-3ECC-9E63-8A0221EBFA9F}'
    );
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

  it('binds the bounded ARES Commander installer wait to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Graebert.AresCommander.2022',
      displayName: 'ARES Commander 2022',
      publisher: 'Graebert',
      version: '21.3.4329',
      architecture: 'x64',
      installerSha256: '4'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/silent',
      uninstallCommand: 'REGISTRY_UNINSTALL:ARES Commander 2022',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedConfig = { reviewedInstallCompletionTimeoutMinutes: 15 };
    const profile = normalized.identity.profile as {
      installer: { silentArgs: string; uninstallCommand: string };
      psadtConfig: typeof expectedConfig;
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject(expectedConfig);
    expect(profile.psadtConfig).toMatchObject(expectedConfig);
    expect(profile.installer.silentArgs).toBe('/silent');
    expect(profile.installer.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL:ARES Commander 2022'
    );
  });

  it('binds MaxTo user scope and its bounded Velopack wait to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Domino.MaxTo',
      displayName: 'MaxTo',
      publisher: 'Domino',
      version: '3.0.1',
      architecture: 'x64',
      installerSha256: '6'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--silent',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:MaxTo:MaxTo',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { installScope: string; silentArgs: string };
      psadtConfig: { reviewedInstallCompletionTimeoutMinutes?: number };
    };

    expect(profile.installer.installScope).toBe('user');
    expect(profile.installer.silentArgs).toBe('--silent');
    expect(profile.psadtConfig.reviewedInstallCompletionTimeoutMinutes).toBe(15);
  });

  it('binds Notesnook user scope to customer and QA packaging without changing its vendor commands', () => {
    const uninstallCommand =
      'REGISTRY_UNINSTALL_PRODUCT:{A05A6719-4910-5E6C-A2AA-9AF71CD1063B}:Notesnook';
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Streetwriters.Notesnook',
      displayName: 'Notesnook',
      publisher: 'Streetwriters',
      version: '3.4.5',
      architecture: 'x64',
      installerSha256: '1C487EAB412C101D6F82D3E1718BB3D9CF13508A664ABDDD8CA7247A594DC6FA',
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand,
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: {
        installScope: string;
        silentArgs: string;
        uninstallCommand: string;
      };
    };

    expect(profile.installer.installScope).toBe('user');
    expect(profile.installer.silentArgs).toBe('/S');
    expect(profile.installer.uninstallCommand).toBe(uninstallCommand);
  });

  it('binds DSH Desktop QA to the exact NSIS key used by customer packages', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'JustGenius-s.DSHDesktop',
      displayName: 'DSH-Decktop',
      publisher: 'JustGenius-s',
      version: '0.2.0',
      architecture: 'x64',
      installerSha256: 'D08A195070FBD32D0CE2282A129145E758BFE2A28A86C0FD6F2EB2B3C6BE20CA',
      installerType: 'nullsoft',
      silentSwitches: '/S /allusers',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:{239D4E5C-394E-5607-BF11-8B5229505789}:DSH-Decktop',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: {
        installScope: string;
        silentArgs: string;
        uninstallCommand: string;
      };
    };

    expect(profile.installer.installScope).toBe('machine');
    expect(profile.installer.silentArgs).toBe('/S /allusers');
    expect(profile.installer.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_KEY:239d4e5c-394e-5607-bf11-8b5229505789:DSH-Desktop 0.2.0'
    );
  });

  it('binds the bounded Retoolkit component wait to customer and QA packaging', () => {
    const silentSwitches =
      '/VERYSILENT /NORESTART /COMPONENTS="*android,*debuggers,*utilities,!network\\\\nmap"';
    const uninstallCommand =
      "REGISTRY_UNINSTALL_KEY:{BB46345D-F5E9-408E-AA39-64A5EDD92E30}_is1:Reverse Engineer's Toolkit (retoolkit)";
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'mentebinaria.retoolkit',
      displayName: "Reverse Engineer's Toolkit (retoolkit)",
      publisher: 'mentebinaria',
      version: '2023.05',
      architecture: 'x64',
      installerSha256: '1'.repeat(64),
      installerType: 'inno',
      silentSwitches,
      uninstallCommand,
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { silentArgs: string; uninstallCommand: string };
      psadtConfig: { reviewedInstallCompletionTimeoutMinutes?: number };
    };

    expect(profile.psadtConfig.reviewedInstallCompletionTimeoutMinutes).toBe(45);
    expect(profile.installer.silentArgs).toBe(silentSwitches);
    expect(profile.installer.uninstallCommand).toBe(uninstallCommand);
    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject({
      reviewedInstallCompletionTimeoutMinutes: 45,
    });
  });

  it('binds the bounded FlashPrint nested EXE wait to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Flashforge.FlashPrint',
      displayName: 'FlashPrint',
      publisher: 'Flashforge',
      version: '5.8.3',
      architecture: 'x64',
      installerSha256: 'a'.repeat(64),
      installerType: 'zip',
      nestedInstallerType: 'exe',
      nestedInstallerPath: 'FlashPrint 5_5.8.3_x64.exe',
      silentSwitches: '/exenoui /qb! REBOOT=ReallySuppress',
      uninstallCommand: 'REGISTRY_UNINSTALL:FlashPrint',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: {
        sourceType: string;
        nestedInstallerType: string;
        nestedInstallerFiles: string[];
      };
      psadtConfig: { reviewedInstallCompletionTimeoutMinutes?: number };
    };

    expect(profile.installer.sourceType).toBe('zip');
    expect(profile.installer.nestedInstallerType).toBe('exe');
    expect(profile.installer.nestedInstallerFiles).toEqual([
      'FlashPrint 5_5.8.3_x64.exe',
    ]);
    expect(profile.psadtConfig.reviewedInstallCompletionTimeoutMinutes).toBe(15);
  });

  it('binds Teradata silent archive removal to customer and QA package identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Teradata.TTUOdbc',
      displayName: 'Teradata ODBC Driver',
      publisher: 'Teradata Corporation',
      version: '20.00.38.00',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'zip',
      nestedInstallerType: 'exe',
      nestedInstallerPath: 'TeradataODBC\\TTUSuiteSilent.exe',
      silentSwitches:
        '/silent ALLARGS="{F075B63A-C629-41F8-BA56-33D9940F2000} 20.00 "ALL" ODBC"',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:{F075B63A-C629-41F8-BA56-33D9940F2000}:Teradata ODBC Driver',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedContract = {
      relativePath: 'TeradataODBC\\silent_uninstall.bat',
      arguments: ['ALL'],
      completionTimeoutMinutes: 15,
    };
    const profile = normalized.identity.profile as {
      psadtConfig: { reviewedArchiveUninstall?: typeof expectedContract };
    };

    expect(profile.psadtConfig.reviewedArchiveUninstall).toEqual(expectedContract);
    expect(JSON.parse(normalized.psadtConfigJson).reviewedArchiveUninstall).toEqual(
      expectedContract
    );
  });

  it('binds the bounded SEGGER installer wait to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Segger.EmbeddedStudioARM',
      displayName: 'SEGGER Embedded Studio for ARM',
      publisher: 'SEGGER',
      version: '8.28',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--silent --accept-license',
      uninstallCommand: 'REGISTRY_UNINSTALL:SEGGER Embedded Studio for ARM',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { silentArgs: string; uninstallCommand: string };
      psadtConfig: { reviewedInstallCompletionTimeoutMinutes?: number };
    };

    expect(profile.psadtConfig.reviewedInstallCompletionTimeoutMinutes).toBe(15);
    expect(profile.installer.silentArgs).toBe('--silent --accept-license');
    expect(profile.installer.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL:SEGGER Embedded Studio for ARM'
    );
  });

  it('binds the bounded Webroot MSI wait to the QA execution profile', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Webroot.SecureAnywhere',
      displayName: 'Webroot SecureAnywhere',
      publisher: 'Webroot',
      version: '9.0.45.63',
      architecture: 'x86',
      installerSha256: 'b'.repeat(64),
      installerType: 'msi',
      silentSwitches: '/qn /norestart ALLUSERS=1',
      uninstallCommand: 'REGISTRY_UNINSTALL:Webroot SecureAnywhere',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { sourceType: string; silentArgs: string };
      psadtConfig: {
        reviewedInstallArguments?: string[];
        reviewedInstallCompletionTimeoutMinutes?: number;
      };
    };

    expect(profile.installer.sourceType).toBe('msi');
    expect(profile.installer.silentArgs).toBe('/qn /norestart ALLUSERS=1');
    expect(profile.psadtConfig.reviewedInstallArguments).toEqual(['CMDLINE=SME,quiet']);
    expect(profile.psadtConfig.reviewedInstallCompletionTimeoutMinutes).toBe(30);
  });

  it('binds Egnyte\'s reboot-suppressed update contract to QA and customer packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Egnyte.EgnyteDesktopApp',
      displayName: 'Egnyte Desktop App',
      publisher: 'Egnyte',
      version: '4.5.1.201',
      architecture: 'x64',
      installerSha256: 'e'.repeat(64),
      installerType: 'msi',
      silentSwitches: '/quiet ALLUSERS=1',
      uninstallCommand: 'msiexec /x "{D205BFAE-B251-4EDF-B4DF-5ABF19F96B59}" /qn /norestart',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      psadtConfig: { reviewedInstallArguments?: string[] };
    };

    expect(profile.psadtConfig.reviewedInstallArguments).toEqual([
      'ED_UPDATE_ON_BOOT=1',
    ]);
    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject({
      reviewedInstallArguments: ['ED_UPDATE_ON_BOOT=1'],
    });
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

  it('binds TreeSize to administrative Inno mode', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'JAMSoftware.TreeSize',
      displayName: 'TreeSize',
      publisher: 'JAMSoftware',
      version: '9.8.2',
      architecture: 'x64',
      installerSha256: '3'.repeat(64),
      installerType: 'inno',
      silentSwitches: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:TreeSize_is1:TreeSize',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { installScope: string };
      psadtConfig: { reviewedInstallArgumentsOverride?: string };
    };

    expect(profile.installer.installScope).toBe('machine');
    expect(profile.psadtConfig.reviewedInstallArgumentsOverride).toBe(
      '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /ALLUSERS'
    );
  });

  it('binds WPS Office to the elevated managed deployment context', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Kingsoft.WPSOffice',
      displayName: 'WPS Office',
      publisher: 'Kingsoft',
      version: '12.2.0.23196',
      architecture: 'x86',
      installerSha256: '1'.repeat(64),
      installerType: 'exe',
      silentSwitches: '-S',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:Kingsoft Office:WPS Office',
      installScope: 'user',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      installer: { installScope: string; silentArgs: string };
      psadtConfig: { reviewedInstallArgumentsOverride?: string };
    };

    expect(profile.installer.installScope).toBe('machine');
    expect(profile.installer.silentArgs).toBe('-S');
    expect(profile.psadtConfig.reviewedInstallArgumentsOverride).toBeUndefined();
  });

  it('binds dotPeek to JetBrains documented silent removal mode', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'JetBrains.dotPeek',
      displayName: 'JetBrains dotPeek',
      publisher: 'JetBrains',
      version: '2026.2.1',
      architecture: 'x86',
      installerSha256: 'd'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/Silent=True /PerMachine=True',
      uninstallCommand:
        'REGISTRY_UNINSTALL_KEY:{90d6dc38-94fa-5eca-b0fc-228f2e524373}:JetBrains dotPeek 2026.2.1',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      psadtConfig: { reviewedUninstallArguments?: string[] };
    };

    expect(profile.psadtConfig.reviewedUninstallArguments).toEqual(['/Silent=True']);
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
      reviewedInstallArguments: [
        `--installPath "${expectedPath}"`,
        '--add Microsoft.VisualStudio.Workload.MSBuildTools',
        '--norestart',
      ],
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

  it('binds SSMS 21 Preview to the unattended Visual Studio Installer removal lifecycle', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Microsoft.SQLServerManagementStudio.21.Preview',
      displayName: 'Microsoft SQL Server Management Studio 21 Preview',
      publisher: 'Microsoft',
      version: '21.0.0',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--quiet --norestart --wait',
      uninstallCommand:
        'REGISTRY_UNINSTALL:Microsoft SQL Server Management Studio 21 Preview',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedConfig = {
      reviewedUninstallArguments: ['--quiet', '--norestart', '--noweb'],
      uninstallCompletionTimeoutMinutes: 15,
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

  it('binds Olive to its exact machine-wide non-ARP lifecycle for customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'OliveTeam.OliveVideoEditor',
      displayName: 'Olive Video Editor',
      publisher: 'Olive Team',
      version: '0.1.0',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'nullsoft',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:Olive Video Editor',
      installScope: 'user',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedConfig = {
      reviewedManagedInstallDirectory: '%ProgramW6432%\\Olive',
      reviewedManagedInstallEvidenceFile:
        '%ProgramW6432%\\Olive\\olive-editor.exe',
      reviewedManagedInstallCompletionTimeoutMinutes: 5,
      reviewedManagedUninstall: {
        executablePath: '%ProgramW6432%\\Olive\\uninstall.exe',
        arguments: ['/S'],
        completionTimeoutMinutes: 5,
      },
    };
    const profile = normalized.identity.profile as {
      installer: { installScope: string };
      psadtConfig: typeof expectedConfig;
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject(expectedConfig);
    expect(profile.installer.installScope).toBe('machine');
    expect(profile.psadtConfig).toMatchObject(expectedConfig);
    expect(normalized.detectionRules).toEqual([
      expect.objectContaining({
        keyPath:
          'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\OliveTeam_OliveVideoEditor',
      }),
    ]);
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
      reviewedInstallArguments: [
        `--installPath "${expectedPath}"`,
        '--add Microsoft.VisualStudio.Workload.MSBuildTools',
        '--norestart',
      ],
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

  it('binds Surfshark visible-primary ARP selection to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Surfshark.Surfshark',
      displayName: 'Surfshark',
      publisher: 'Surfshark',
      version: '6.16.0.999',
      architecture: 'x64',
      installerSha256: 'd'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/quiet',
      uninstallCommand: 'REGISTRY_UNINSTALL:Surfshark',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      psadtConfig: {
        reviewedPreferVisiblePrimaryUninstallRegistration?: boolean;
      };
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject({
      reviewedPreferVisiblePrimaryUninstallRegistration: true,
    });
    expect(
      profile.psadtConfig.reviewedPreferVisiblePrimaryUninstallRegistration
    ).toBe(true);
  });

  it('binds iFun Screenshot exact captured-identity recovery to customer and QA packaging', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'IObit.iFunScreenshot',
      displayName: 'iFun Screenshot',
      publisher: 'IObit',
      version: '1.2.0.526',
      architecture: 'x86',
      installerSha256: 'e'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      uninstallCommand:
        'REGISTRY_UNINSTALL_KEY:iFun Screenshot_is1:iFun Screenshot',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const profile = normalized.identity.profile as {
      psadtConfig: {
        reviewedRecoverCapturedUninstallByExactIdentity?: boolean;
      };
    };

    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject({
      reviewedRecoverCapturedUninstallByExactIdentity: true,
    });
    expect(
      profile.psadtConfig.reviewedRecoverCapturedUninstallByExactIdentity
    ).toBe(true);
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

  it('binds reviewed Windows App Runtime 1.3 Appx evidence to the QA identity', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Microsoft.WindowsAppRuntime.1.3',
      displayName: 'Windows App Runtime',
      publisher: 'Microsoft',
      version: '1.3.3',
      architecture: 'x64',
      installerSha256: 'e'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--quiet',
      uninstallCommand: 'REGISTRY_UNINSTALL:Windows App Runtime',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });
    const expectedEvidence = {
      packageName: 'Microsoft.WindowsAppRuntime.1.3',
      publisherId: '8wekyb3d8bbwe',
      minimumVersion: '3000.934.1904.0',
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
        wingetId: 'Elgato.CameraHub',
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
