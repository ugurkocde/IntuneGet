import { describe, expect, it, vi } from 'vitest';

const { getCatalogSourceMock } = vi.hoisted(() => ({
  getCatalogSourceMock: vi.fn(),
}));

vi.mock('@/lib/catalog', () => ({ getCatalogSource: getCatalogSourceMock }));
vi.mock('@/lib/supabase', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDatabase: vi.fn() }));

import { lookupInstallerDetails } from './batch-orchestrator';

describe('lookupInstallerDetails', () => {
  it('selects the requested architecture from PascalCase installer JSON', async () => {
    getCatalogSourceMock.mockReturnValue({
      getLatestVersionInstallerInfo: vi.fn().mockResolvedValue({
        installer_url: 'https://example.com/arm64.exe',
        installer_sha256: 'A'.repeat(64),
        installer_type: 'exe',
        installers: [
          {
            Architecture: 'arm64',
            InstallerUrl: 'https://example.com/arm64.exe',
            InstallerSha256: 'A'.repeat(64),
            InstallerType: 'exe',
            Scope: 'machine',
          },
          {
            Architecture: 'x64',
            InstallerUrl: 'https://example.com/x64.exe',
            InstallerSha256: 'B'.repeat(64),
            InstallerType: 'exe',
            Scope: 'machine',
          },
        ],
      }),
    });

    await expect(lookupInstallerDetails('Example.App', '1.0.0', 'x64')).resolves.toMatchObject({
      architecture: 'x64',
      installer_url: 'https://example.com/x64.exe',
      installer_sha256: 'B'.repeat(64),
    });
  });
});
