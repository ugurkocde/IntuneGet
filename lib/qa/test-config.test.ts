import { describe, expect, it } from 'vitest';
import { buildQaCatalogTestConfig } from './test-config';

describe('buildQaCatalogTestConfig', () => {
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
      uninstallCommand: 'REGISTRY_UNINSTALL:Example',
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

  it.each([
    ['inno', '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART'],
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
      silentArgs: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
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
      '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS'
    );
  });

  it('uses installer switch objects without merging root switch keys', () => {
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

    expect(config.silentArgs).toBe('/S /CURRENTUSER');
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
});
