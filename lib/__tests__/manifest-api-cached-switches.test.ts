import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearManifestCache, getInstallers } from '../manifest-api';

const cached = vi.hoisted(() => ({ row: {} as Record<string, unknown> }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        single: async () => ({
          data: table === 'version_history' ? cached.row : null,
          error: null,
        }),
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/catalog', () => ({ getCatalogSource: vi.fn() }));

describe('cached installer switch ownership', () => {
  beforeEach(() => {
    clearManifestCache();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.invalid');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected network'); }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function useCachedInstaller(defaultType: string, type: string, switches = {}, stringified = true) {
    const installers = [{
      Architecture: 'x64',
      InstallerType: type,
      Scope: 'machine',
      InstallerUrl: 'https://example.invalid/payload.msi',
      InstallerSha256: 'A'.repeat(64),
      InstallerSwitches: switches,
    }];
    cached.row = {
      version: '1.0',
      installer_type: defaultType,
      silent_args: '/S',
      manifest_yaml: null,
      installers: stringified ? JSON.stringify(installers) : installers,
    };
  }

  it.each(['exe', 'nullsoft'])('does not give a WiX installer the %s row switch', async (defaultType) => {
    useCachedInstaller(defaultType, 'wix', { InstallLocation: 'INSTALLDIR="<INSTALLPATH>"' });
    const [installer] = await getInstallers('Example.Mixed', '1.0');
    expect(installer.silentArgs).toBe('/qn /norestart ALLUSERS=1');
    expect(installer).toMatchObject({
      type: 'wix', architecture: 'x64', scope: 'machine',
      url: 'https://example.invalid/payload.msi', sha256: 'A'.repeat(64),
    });
  });

  it('handles array caches without inheriting another installer family switch', async () => {
    useCachedInstaller('nullsoft', 'wix', {}, false);
    expect((await getInstallers('Example.Mixed', '1.0'))[0].silentArgs)
      .toBe('/qn /norestart ALLUSERS=1');
  });

  it('preserves installer-specific switches across different row types', async () => {
    useCachedInstaller('nullsoft', 'wix', { Silent: '/quiet ACCEPTLICENSE=YES', Custom: 'MODE=managed' });
    expect((await getInstallers('Example.Mixed', '1.0'))[0].silentArgs)
      .toBe('/quiet ACCEPTLICENSE=YES MODE=managed ALLUSERS=1');
  });

  it('preserves row switches for the same installer family', async () => {
    useCachedInstaller('nullsoft', 'nullsoft', { Custom: '/ALLUSERS' });
    expect((await getInstallers('Example.Mixed', '1.0'))[0].silentArgs).toBe('/S /ALLUSERS');
  });

  it.each([['msi', 'wix'], ['wix', 'msi']])('preserves compatible %s row properties for %s', async (defaultType, type) => {
    useCachedInstaller(defaultType, type);
    cached.row.silent_args = '/qn ACCEPTLICENSE=YES';
    expect((await getInstallers('Example.Mixed', '1.0'))[0].silentArgs)
      .toBe('/qn ACCEPTLICENSE=YES ALLUSERS=1');
  });
});
