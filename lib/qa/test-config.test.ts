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
    expect(config.psadtConfig.deployMode).toBe('Silent');
    expect(config.detectionRules[0]).toMatchObject({
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Contoso_Example',
      valueName: 'Version',
      detectionValue: '2.0.0',
    });
  });
});
