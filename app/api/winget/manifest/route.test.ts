import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ versions: vi.fn(), installers: vi.fn(), manifest: vi.fn() }));
vi.mock('@/lib/manifest-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/manifest-api')>(),
  fetchAvailableVersionsLive: mocks.versions,
  getLiveInstallers: mocks.installers,
}));
vi.mock('@/lib/winget-api', () => ({ getManifest: mocks.manifest }));
import { GitHubUnavailableError } from '@/lib/manifest-api';
import { GET } from './route';

const currentInstaller = { architecture: 'x64', url: 'https://example.test/new.msi', sha256: 'A'.repeat(64), type: 'msi' };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.versions.mockResolvedValue(['2.0']);
  mocks.installers.mockResolvedValue([currentInstaller]);
  mocks.manifest.mockResolvedValue({ Id: 'Example.App', Name: 'Example', Version: '2.0', Publisher: 'Example' });
});

describe('manifest selection availability', () => {
  it('offers live versions and installers even when cached metadata contains older installers', async () => {
    mocks.manifest.mockResolvedValue({ Name: 'Example', Version: '1.0', Installers: [{ InstallerUrl: 'old.exe' }] });
    const response = await GET(new NextRequest('https://example.test/api/winget/manifest?id=Example.App'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ manifest: { version: '2.0' }, versions: ['2.0'], installers: [currentInstaller] });
    expect(mocks.installers).toHaveBeenCalledWith('Example.App', '2.0');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('rejects removed historical selections before reading cached installer metadata', async () => {
    const response = await GET(new NextRequest('https://example.test/api/winget/manifest?id=Example.App&version=1.0'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'MANIFEST_UNAVAILABLE', retryable: false, versions: ['2.0'] });
    expect(mocks.manifest).not.toHaveBeenCalled();
    expect(mocks.installers).not.toHaveBeenCalled();
  });

  it('handles removal between listing versions and reading the manifest', async () => {
    mocks.installers.mockResolvedValue([]);
    const response = await GET(new NextRequest('https://example.test/api/winget/manifest?id=Example.App&version=2.0'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ retryable: false });
  });

  it('reports an upstream outage as retryable without falling back to historical versions', async () => {
    mocks.versions.mockRejectedValue(new GitHubUnavailableError(429));
    const response = await GET(new NextRequest('https://example.test/api/winget/manifest?id=Example.App'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', retryable: true });
    expect(mocks.manifest).not.toHaveBeenCalled();
  });

  it('can show trusted installers when descriptive metadata is missing', async () => {
    mocks.manifest.mockResolvedValue(null);
    const response = await GET(new NextRequest('https://example.test/api/winget/manifest?id=Example.App'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ manifest: { id: 'Example.App', version: '2.0' }, installers: [currentInstaller] });
  });

  it('requires an exact package ID', async () => {
    expect((await GET(new NextRequest('https://example.test/api/winget/manifest'))).status).toBe(400);
    expect(mocks.versions).not.toHaveBeenCalled();
  });

  it('still verifies an exact selection when only the version directory lookup is unavailable', async () => {
    mocks.versions.mockRejectedValue(new GitHubUnavailableError(429));
    const response = await GET(new NextRequest('https://example.test/api/winget/manifest?id=Example.App&version=2.0'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ versions: ['2.0'], installers: [currentInstaller] });
    expect(mocks.installers).toHaveBeenCalledWith('Example.App', '2.0');
  });
});
