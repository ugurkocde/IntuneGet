import { describe, expect, it } from 'vitest';
import { buildQaCatalogTestConfig } from './test-config';

describe('buildQaCatalogTestConfig', () => {
  it('adds the reviewed Movavi success code to catalog QA packaging', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Movavi.MovaviPhotoFocus',
        name: 'Movavi Photo Focus',
        publisher: 'Movavi',
        version: '1.1.0',
      },
      manifest: { InstallerType: 'nullsoft' },
      installer: {
        Architecture: 'x86',
        InstallerType: 'nullsoft',
        ProductCode: 'Movavi Photo Focus',
      },
    });

    expect(config.successCodes).toEqual([1223]);
  });

  it('normalizes TeamSpeak 6 Beta contradictory user manifest to machine QA', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'TeamSpeakSystems.TeamSpeakClient.Beta.6',
        name: 'TeamSpeak 6 Beta',
        publisher: 'TeamSpeakSystems',
        version: '6.0.0-beta4.1',
      },
      manifest: {
        InstallerType: 'wix',
        Scope: 'user',
        InstallerSwitches: { Custom: 'ALLUSERS=1' },
        ProductCode: '{7BC5AB94-97F7-480C-A8A0-3D334A3A56DC}',
      },
      installer: {
        Architecture: 'x64',
        InstallerType: 'wix',
        Scope: 'user',
        ProductCode: '{7BC5AB94-97F7-480C-A8A0-3D334A3A56DC}',
      },
    });

    expect(config.scope).toBe('machine');
    expect(config.silentArgs).toBe('/qn /norestart ALLUSERS=1');
    expect(config.detectionRules[0]).toMatchObject({
      keyPath:
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\TeamSpeakSystems_TeamSpeakClient_Beta_6',
      detectionValue: '6.0.0-beta4.1',
    });
  });

  it('adds the Simple Hydraulic Calculator exact NSIS removal to catalog QA', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Igneus.SimpleHydraulicCalculator',
        name: 'Simple Hydraulic Calculator',
        publisher: 'Igneus',
        version: '2.3.9',
      },
      manifest: { InstallerType: 'nullsoft', Scope: 'machine' },
      installer: {
        Architecture: 'x86',
        InstallerType: 'nullsoft',
        Scope: 'machine',
        ProductCode: 'Simple Hydraulic Calculator',
      },
    });

    expect(config.psadtConfig.reviewedExactUninstall).toEqual({
      executablePath:
        '%ProgramFiles(x86)%\\Igneus\\SHC\\shc2uninstall.exe',
      arguments: ['/S _?=%ProgramFiles(x86)%\\Igneus\\SHC'],
      completionTimeoutMinutes: 5,
    });
    expect(config.psadtConfig.reviewedUninstallWindowAutomation).toEqual({
      processName: 'shc2uninstall.exe',
      steps: [
        {
          windowText: 'Simple Hydraulic Calculator',
          buttonIndex: 1,
          timeoutSeconds: 60,
        },
      ],
    });
  });

  it('prefers installer-specific silent switches and product metadata', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Contoso.Example',
        name: 'Example',
        publisher: 'Contoso',
        version: '2.0.0',
      },
      manifest: { InstallerType: 'exe', InstallerSwitches: { Silent: '/quiet-root' } },
      installer: {
        Architecture: 'x64',
        InstallerType: 'inno',
        InstallerSwitches: { Silent: '/VERYSILENT' },
        AppsAndFeaturesEntries: [{ ProductCode: '{00000000-0000-0000-0000-000000000001}' }],
      },
    });

    expect(config).toMatchObject({
      mode: 'psadt-package',
      displayName: 'Example',
      publisher: 'Contoso',
      sourceInstallerType: 'inno',
      silentArgs: '/VERYSILENT',
      productCode: '{00000000-0000-0000-0000-000000000001}',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:{00000000-0000-0000-0000-000000000001}:Example',
      profileKind: 'catalog-default',
    });
    expect(config.psadtConfig).toMatchObject({
      deployMode: 'Auto',
      progressDialog: {
        enabled: true,
        statusMessage: 'IntuneGet is validating this application package.',
        windowLocation: 'BottomRight',
      },
    });
    expect(config.detectionRules[0]).toMatchObject({
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Contoso_Example',
      valueName: 'Version',
      detectionValue: '2.0.0',
    });
  });

  it('reconciles FSLogix WinGet metadata to its registered bundle display name', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Microsoft.FSLogix',
        name: 'FSLogix',
        publisher: 'Microsoft',
        version: '3.26.126.19110',
      },
      manifest: {
        InstallerType: 'zip',
        NestedInstallerType: 'exe',
        ProductCode: 'Microsoft FSLogix Apps',
        InstallerSwitches: { Silent: '/install /quiet /norestart' },
      },
      installer: {
        Architecture: 'neutral',
        InstallerType: 'zip',
        NestedInstallerType: 'exe',
        ProductCode: 'Microsoft FSLogix Apps',
      },
    });

    expect(config.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL:Microsoft FSLogix Apps'
    );
    expect(config.psadtConfig.reviewedUninstallArguments).toEqual([
      '/norestart',
    ]);
  });

  it('binds Chrome Beta EXE QA to the vendor channel uninstall key', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Google.Chrome.Beta.EXE',
        name: 'Google Chrome Beta (EXE)',
        publisher: 'Google',
        version: '152.0.7977.54',
      },
      manifest: {
        InstallerType: 'exe',
        ProductCode: 'Google Chrome',
        InstallerSwitches: {
          Silent: '--do-not-launch-chrome --system-level --chrome-beta',
        },
      },
      installer: {
        Architecture: 'x64',
        InstallerType: 'exe',
        ProductCode: 'Google Chrome',
        AppsAndFeaturesEntries: [{
          DisplayName: 'Google Chrome Beta (EXE)',
          ProductCode: 'Google Chrome',
        }],
      },
    });

    expect(config.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_KEY:Google Chrome Beta:Google Chrome Beta'
    );
  });

  it.each([
    ['inno', '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-'],
    ['nullsoft', '/S'],
  ])('applies the WinGet default silent switches for %s installers', (installerType, expected) => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Contoso.Example',
        name: 'Example',
        publisher: 'Contoso',
        version: '2.0.0',
      },
      manifest: { InstallerType: installerType },
      installer: { Architecture: 'x64', InstallerType: installerType },
    });

    expect(config.silentArgs).toBe(expected);
  });

  it('inherits root nested installer metadata for zip packages', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Contoso.Archive',
        name: 'Archive',
        publisher: 'Contoso',
        version: '1.0.0',
      },
      manifest: {
        InstallerType: 'zip',
        NestedInstallerType: 'inno',
        NestedInstallerFiles: [{ RelativeFilePath: 'setup\\install.exe' }],
      },
      installer: { Architecture: 'x64', InstallerType: 'zip' },
    });

    expect(config).toMatchObject({
      sourceInstallerType: 'zip',
      nestedInstallerType: 'inno',
      nestedInstallerFiles: ['setup\\install.exe'],
      silentArgs: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
    });
  });

  it('keeps a nested MSI ProductCode in the canonical QA uninstall identity', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'FinancialID.BankID',
        name: 'BankID säkerhetsprogram',
        publisher: 'FinancialID',
        version: '7.17.101.2526',
      },
      manifest: {
        InstallerType: 'zip',
        NestedInstallerType: 'msi',
      },
      installer: {
        Architecture: 'x86',
        InstallerType: 'zip',
        NestedInstallerType: 'msi',
        NestedInstallerFiles: [{ RelativeFilePath: 'BankID.msi' }],
        ProductCode: '{77B5BCDC-5496-48DA-8B16-5EE2AF08CA31}',
        Scope: 'machine',
      },
    });

    expect(config).toMatchObject({
      sourceInstallerType: 'zip',
      nestedInstallerType: 'msi',
      nestedInstallerFiles: ['BankID.msi'],
      productCode: '{77B5BCDC-5496-48DA-8B16-5EE2AF08CA31}',
      uninstallCommand:
        'REGISTRY_UNINSTALL_PRODUCT:{77B5BCDC-5496-48DA-8B16-5EE2AF08CA31}:BankID säkerhetsprogram',
    });
  });

  it('appends inherited custom switches to the derived silent default', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Contoso.Example',
        name: 'Example',
        publisher: 'Contoso',
        version: '2.0.0',
      },
      manifest: { InstallerType: 'inno', InstallerSwitches: { Custom: '/ALLUSERS' } },
      installer: { Architecture: 'x64', InstallerType: 'inno' },
    });

    expect(config.silentArgs).toBe(
      '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /ALLUSERS'
    );
  });

  it('inherits root switch fields that are not overridden by the installer', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Contoso.Example',
        name: 'Example',
        publisher: 'Contoso',
        version: '2.0.0',
      },
      manifest: { InstallerType: 'nullsoft', InstallerSwitches: { Silent: '/ROOT' } },
      installer: {
        Architecture: 'x64',
        InstallerType: 'nullsoft',
        InstallerSwitches: { Custom: '/CURRENTUSER' },
      },
    });

    expect(config.silentArgs).toBe('/ROOT /CURRENTUSER');
  });

  it('includes a required WinGet install location in the shared QA package arguments', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Blizzard.BattleNet',
        name: 'Battle.net Setup',
        publisher: 'Blizzard',
        version: '1.19.3.3219',
      },
      manifest: {
        InstallerType: 'exe',
        Scope: 'machine',
        InstallLocationRequired: true,
        InstallerSwitches: {
          Custom: '--lang=enUS',
          InstallLocation: '--installpath="<INSTALLPATH>"',
        },
        InstallationMetadata: {
          DefaultInstallLocation: '%PROGRAMFILES(X86)%\\Battle.net',
        },
      },
      installer: {
        Architecture: 'x86',
        InstallerType: 'exe',
        ProductCode: 'Battle.net',
      },
    });

    expect(config.silentArgs).toBe(
      '--lang=enUS --installpath="%PROGRAMFILES(X86)%\\Battle.net"'
    );
  });

  it('preserves the WinGet machine scope for Arduino-style dual-purpose MSI packages', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'ArduinoSA.IDE.stable',
        name: 'Arduino IDE',
        publisher: 'ArduinoSA',
        version: '2.3.10',
      },
      manifest: { InstallerType: 'wix' },
      installer: {
        Architecture: 'x64',
        InstallerType: 'wix',
        Scope: 'machine',
        ProductCode: '{2512FA64-8592-4C98-8430-9262623F95F0}',
      },
    });

    expect(config).toMatchObject({
      scope: 'machine',
      silentArgs: '/qn /norestart ALLUSERS=1',
      productCode: '{2512FA64-8592-4C98-8430-9262623F95F0}',
      uninstallCommand:
        'msiexec /x "{2512FA64-8592-4C98-8430-9262623F95F0}" /qn /norestart',
    });
  });

  it('preserves Vivaldi-style root silent and installer custom switches', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Vivaldi.Vivaldi',
        name: 'Vivaldi',
        publisher: 'Vivaldi',
        version: '8.1.4087.62',
      },
      manifest: {
        InstallerType: 'exe',
        InstallerSwitches: { Silent: '--vivaldi-silent' },
      },
      installer: {
        Architecture: 'x64',
        InstallerType: 'exe',
        Scope: 'user',
        InstallerSwitches: { Custom: '--do-not-launch-chrome' },
      },
    });

    expect(config.silentArgs).toBe('--vivaldi-silent --do-not-launch-chrome');
  });

  it('keeps portable packages argument-free', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Contoso.Portable',
        name: 'Portable',
        publisher: 'Contoso',
        version: '1.0.0',
      },
      manifest: { InstallerType: 'portable' },
      installer: { Architecture: 'x64', InstallerType: 'portable' },
    });

    expect(config.silentArgs).toBe('');
  });

  it('inherits a root MSI product code for exact silent uninstall', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Exclaimer.CloudSignatureUpdateAgent',
        name: 'Exclaimer Cloud Signature Update Agent',
        publisher: 'Exclaimer',
        version: '1.21.0.0',
      },
      manifest: {
        InstallerType: 'wix',
        ProductCode: '{D1827F05-CDAB-444B-90E3-D52ACB111CBD}',
      },
      installer: {
        Architecture: 'x86',
        InstallerType: 'wix',
        Scope: 'machine',
      },
    });

    expect(config.productCode).toBe('{D1827F05-CDAB-444B-90E3-D52ACB111CBD}');
    expect(config.uninstallCommand).toBe(
      'msiexec /x "{D1827F05-CDAB-444B-90E3-D52ACB111CBD}" /qn /norestart'
    );
  });

  it('inherits installer success codes from the manifest contract', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'HP.ImageAssistant',
        name: 'HP Image Assistant',
        publisher: 'HP',
        version: '5.3.6',
      },
      manifest: { InstallerType: 'exe', InstallerSuccessCodes: [1168] },
      installer: { Architecture: 'x64', InstallerType: 'exe' },
    });
    expect(config.successCodes).toEqual([1168]);
  });

  it('converts Recuva unsigned WinGet success codes to signed process exit codes', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Piriform.Recuva',
        name: 'Recuva',
        publisher: 'Piriform',
        version: '1.54.120',
      },
      manifest: {
        InstallerType: 'nullsoft',
        InstallerSuccessCodes: [3221225477, 3221226505],
      },
      installer: { Architecture: 'x64', InstallerType: 'nullsoft' },
    });
    expect(config.successCodes).toEqual([-1073741819, -1073740791]);
  });

  it('uses an EXE AppsAndFeatures product code as the exact uninstall identity', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Adobe.Acrobat.Reader.64-bit',
        name: 'Adobe Acrobat Reader (64-bit)',
        publisher: 'Adobe',
        version: '26.001.21771',
      },
      manifest: { InstallerType: 'exe' },
      installer: {
        Architecture: 'x64',
        InstallerType: 'exe',
        AppsAndFeaturesEntries: [
          { ProductCode: '{AC76BA86-1033-FF00-7760-BC15014EA700}' },
        ],
      },
    });

    expect(config.productCode).toBe(
      '{AC76BA86-1033-FF00-7760-BC15014EA700}'
    );
    expect(config.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_PRODUCT:{AC76BA86-1033-FF00-7760-BC15014EA700}:Adobe Acrobat Reader (64-bit)'
    );
  });

  it('uses the reviewed ARP identity for the Google Chrome EXE catalog variant', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Google.Chrome.EXE',
        name: 'Google Chrome (EXE)',
        publisher: 'Google',
        version: '151.0.7922.76',
      },
      manifest: { InstallerType: 'exe' },
      installer: {
        Architecture: 'x64',
        InstallerType: 'exe',
        InstallerSwitches: { Silent: '/silent /install' },
      },
    });

    expect(config.uninstallCommand).toBe('REGISTRY_UNINSTALL:Google Chrome');
  });

  it('prefers architecture-specific AppsAndFeatures identity over a root product code', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Contoso.MultiArch',
        name: 'Contoso MultiArch',
        publisher: 'Contoso',
        version: '2.0.0',
      },
      manifest: {
        InstallerType: 'wix',
        ProductCode: '{11111111-1111-1111-1111-111111111111}',
      },
      installer: {
        Architecture: 'x86',
        InstallerType: 'wix',
        AppsAndFeaturesEntries: [
          { ProductCode: '{22222222-2222-2222-2222-222222222222}' },
        ],
      },
    });

    expect(config.productCode).toBe('{22222222-2222-2222-2222-222222222222}');
  });

  it('skips malformed AppsAndFeatures identities and uses the next canonical GUID', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Contoso.MultiEntry',
        name: 'Contoso Multi Entry',
        publisher: 'Contoso',
        version: '2.0.0',
      },
      manifest: { InstallerType: 'exe' },
      installer: {
        Architecture: 'x64',
        InstallerType: 'exe',
        AppsAndFeaturesEntries: [
          { ProductCode: 'not\\a:guid' },
          { ProductCode: '{33333333-3333-3333-3333-333333333333}' },
        ],
      },
    });

    expect(config.productCode).toBe('{33333333-3333-3333-3333-333333333333}');
  });

  it('does not replace an explicit Inno registry key with an inherited MSI-style GUID', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Contoso.InnoApp',
        name: 'Contoso Inno App',
        publisher: 'Contoso',
        version: '2.0.0',
      },
      manifest: {
        InstallerType: 'inno',
        ProductCode: '{11111111-1111-1111-1111-111111111111}',
      },
      installer: {
        Architecture: 'x64',
        InstallerType: 'inno',
        ProductCode: '{22222222-2222-2222-2222-222222222222}_is1',
      },
    });

    expect(config.productCode).toBe(
      '{22222222-2222-2222-2222-222222222222}_is1'
    );
    expect(config.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_KEY:{22222222-2222-2222-2222-222222222222}_is1:Contoso Inno App'
    );
  });

  it('uses a root non-MSI ProductCode as the exact ARP lifecycle identity', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'JetBrains.IntelliJIDEA.Ultimate',
        name: 'IntelliJ IDEA Ultimate Edition',
        publisher: 'JetBrains',
        version: '2025.2.5',
      },
      manifest: {
        InstallerType: 'nullsoft',
        ProductCode: 'IntelliJ IDEA 2025.2.5',
      },
      installer: {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/idea.exe',
        InstallerSha256: 'A'.repeat(64),
        InstallerType: 'nullsoft',
        Scope: 'machine',
      },
    });

    expect(config.productCode).toBe('IntelliJ IDEA 2025.2.5');
    expect(config.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_KEY:IntelliJ IDEA 2025.2.5:IntelliJ IDEA Ultimate Edition'
    );
  });

  it('inherits a root package family name for user-scoped MSIX handling', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Microsoft.WindowsTerminal',
        name: 'Windows Terminal',
        publisher: 'Microsoft',
        version: '1.24.11911.0',
      },
      manifest: {
        InstallerType: 'msix',
        Scope: 'user',
        PackageFamilyName: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe',
      },
      installer: {
        Architecture: 'x64',
        InstallerType: 'msix',
      },
    });

    expect(config.uninstallCommand).toBe('MSIX_UNINSTALL:Microsoft.WindowsTerminal');
    expect(config.detectionRules[0]).toMatchObject({ type: 'script' });
    const script = 'scriptContent' in config.detectionRules[0]
      ? config.detectionRules[0].scriptContent
      : '';
    expect(script).toContain('Get-AppxPackage -Name "Microsoft.WindowsTerminal"');
    expect(script).toContain(
      '[Security.Principal.WindowsIdentity]::GetCurrent().IsSystem'
    );
    expect(script).toContain(
      'if (-not $package -and $runningAsSystem) { $package = Get-AppxPackage -Name "Microsoft.WindowsTerminal" -AllUsers }'
    );
  });

  it('does not include the disproven Stream Deck uninstall guard in the catalog profile', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Elgato.StreamDeck',
        name: 'Elgato Stream Deck',
        publisher: 'Elgato',
        version: '7.5.1.22901',
      },
      manifest: {
        InstallerType: 'wix',
        Scope: 'machine',
        ProductCode: '{ED591028-8D85-4D44-AA11-B2D8EC905F91}',
      },
      installer: {
        Architecture: 'x64',
        InstallerType: 'wix',
      },
    });

    expect(config.psadtConfig.processesToClose).toEqual([]);
    expect(config.psadtConfig.reviewedUninstallProcessGuard).toBeUndefined();
  });

  it('includes the reviewed Creative Cloud process adapter in the catalog profile', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Adobe.CreativeCloud',
        name: 'Adobe Creative Cloud',
        publisher: 'Adobe',
        version: '6.10.0.252.3',
      },
      manifest: {
        InstallerType: 'exe',
        Scope: 'machine',
      },
      installer: {
        Architecture: 'x86',
        InstallerType: 'exe',
        InstallerSwitches: { Silent: '--mode=stub' },
      },
    });

    expect(config.psadtConfig.processesToClose.map(({ name }) => name)).toEqual([
      'Creative Cloud',
      'AdobeDesktopService',
      'AdobeCEFHelper',
      'AdobeInstaller',
      'AdobeUpdateService',
      'CCLibrary',
      'CCXProcess',
      'CoreSync',
      'AdobeIPCBroker',
      'AdobeNotificationClient',
      'CreativeCloudHelper',
    ]);
  });

  it('tests a reviewed per-user bootstrapper in user context when WinGet omits scope', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'VNGCorp.Zalo',
        name: 'Zalo',
        publisher: 'VNGCorp',
        version: '26.8.10',
      },
      manifest: {
        InstallerType: 'nullsoft',
        ProductCode: 'f0c47de4-c117-54e4-97d9-eb3fd2985e6c',
      },
      installer: {
        Architecture: 'x86',
        InstallerType: 'nullsoft',
        InstallerSwitches: { Silent: '/S' },
      },
    });

    expect(config.scope).toBe('user');
    expect(config.detectionRules).toEqual([
      expect.objectContaining({
        keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\VNGCorp_Zalo',
      }),
    ]);
  });

  it('tests RedisInsight in user context when its NSIS manifest omits scope', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'RedisInsight.RedisInsight',
        name: 'Redis Insight',
        publisher: 'Redis Ltd.',
        version: '3.4.2',
      },
      manifest: {
        InstallerType: 'nullsoft',
        ProductCode: '35443657-9fe0-5c86-a3fe-135cfbd99cbb',
        AppsAndFeaturesEntries: [{ DisplayName: 'Redis Insight' }],
      },
      installer: {
        Architecture: 'x64',
        InstallerType: 'nullsoft',
        InstallerSwitches: { Silent: '/S' },
      },
    });

    expect(config.scope).toBe('user');
    expect(config.detectionRules).toEqual([
      expect.objectContaining({
        keyPath:
          'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\RedisInsight_RedisInsight',
      }),
    ]);
  });

  it('tests Youdao in user context when its NSIS manifest omits scope', () => {
    const config = buildQaCatalogTestConfig({
      app: {
        wingetId: 'Youdao.YoudaoTranslate',
        name: '网易有道翻译',
        publisher: 'Youdao',
        version: '11.3.16.0',
      },
      manifest: {
        InstallerType: 'exe',
      },
      installer: {
        Architecture: 'x86',
        InstallerType: 'exe',
        InstallerSwitches: { Silent: '/S' },
      },
    });

    expect(config.scope).toBe('user');
    expect(config.detectionRules).toEqual([
      expect.objectContaining({
        keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Youdao_YoudaoTranslate',
      }),
    ]);
  });
});
