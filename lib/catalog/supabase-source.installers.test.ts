import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseCatalogSource } from './supabase-source';

const { single } = vi.hoisted(() => ({ single: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        single,
      };
      return query;
    },
  }),
}));

const installers = [{
  Architecture: 'x64',
  Scope: 'machine',
  InstallerUrl: 'https://example.invalid/setup.exe',
  InstallerSha256: 'A'.repeat(64),
  InstallerSwitches: { Silent: '/quiet' },
}];

beforeEach(() => single.mockReset());

describe.each(['getVersionInstallerInfo', 'getLatestVersionInstallerInfo'] as const)('%s', (method) => {
  it('restores JSON-string installer metadata without changing its fields', async () => {
    single.mockResolvedValue({ data: { installers: JSON.stringify(installers), installer_type: 'exe' }, error: null });
    const result = await new SupabaseCatalogSource()[method]('Example.App', '1.0');
    expect(result?.installers).toEqual(installers);
    expect(result?.installer_type).toBe('exe');
  });

  it('keeps missing or malformed metadata unavailable', async () => {
    single.mockResolvedValue({ data: { installers: '{invalid' }, error: null });
    expect((await new SupabaseCatalogSource()[method]('Example.App', '1.0'))?.installers).toBeNull();
  });
});
