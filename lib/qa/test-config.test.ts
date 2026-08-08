import { describe, expect, it } from 'vitest';
import { buildQaCatalogTestConfig } from './test-config';

describe('buildQaCatalogTestConfig', () => {
  it('prefers installer-specific silent switches and product metadata', () => {
    const config = buildQaCatalogTestConfig({
      app: { name: 'Example', publisher: 'Contoso' },
      manifest: { InstallerType: 'exe', InstallerSwitches: { Silent: '/quiet-root' } },
      installer: {
        Architecture: 'x64',
        InstallerType: 'inno',
        InstallerSwitches: { Silent: '/VERYSILENT' },
        AppsAndFeaturesEntries: [{ ProductCode: '{00000000-0000-0000-0000-000000000001}' }],
      },
    });

    expect(config).toMatchObject({
      mode: 'catalog',
      displayName: 'Example',
      publisher: 'Contoso',
      sourceInstallerType: 'inno',
      silentArgs: '/VERYSILENT',
      productCode: '{00000000-0000-0000-0000-000000000001}',
    });
  });
});
