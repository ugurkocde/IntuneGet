import { describe, expect, it, vi } from 'vitest';
import type { PackagerConfig } from '../src/config';
import * as uploaderModule from '../src/intune-uploader';
import { IntuneUploader } from '../src/intune-uploader';
import type { PackagingJob } from '../src/job-poller';

type GraphMock = {
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

type TestableUploader = {
  createWin32App(graphClient: GraphMock, job: PackagingJob, packageFileName: string): Promise<{ id: string }>;
};

const config: PackagerConfig = {
  packagerId: 'test-packager',
  mode: 'api',
  supabase: { url: '', serviceRoleKey: '' },
  api: { url: 'https://example.com', key: 'test-key' },
  azure: { clientId: '00000000-0000-0000-0000-000000000000', useManagedIdentity: false },
  polling: { interval: 5000, staleJobTimeout: 300000 },
  paths: { work: 'work', tools: 'tools' },
};

const SOURCE_UUID = '11111111-1111-4111-8111-111111111111';

function packagingJob(packageConfig: Record<string, unknown> = {}): PackagingJob {
  return {
    id: 'job-2145',
    user_id: 'user-1',
    user_email: 'qa@example.com',
    tenant_id: 'tenant-1',
    winget_id: 'Contoso.Example',
    version: '2.0.0',
    display_name: 'Contoso Example',
    publisher: 'Contoso',
    architecture: 'x64',
    installer_type: 'exe',
    installer_url: 'https://example.com/setup.exe',
    installer_sha256: 'A'.repeat(64),
    install_command: '/S',
    uninstall_command: '/U',
    install_scope: 'machine',
    detection_rules: [],
    package_config: packageConfig,
    status: 'queued',
    progress_percent: 0,
    created_at: '2026-11-27T00:00:00.000Z',
  };
}

function graphMock(): GraphMock {
  return {
    post: vi.fn().mockResolvedValue({ id: 'new-app-1' }),
    get: vi.fn(),
    patch: vi.fn().mockResolvedValue(undefined),
  };
}

describe('IntuneUploader allowAvailableUninstall', () => {
  it('exports strict extractAllowAvailableUninstall parser', () => {
    const extract = (uploaderModule as Record<string, unknown>).extractAllowAvailableUninstall as (v: unknown) => boolean | undefined;
    expect(typeof extract).toBe('function');
    expect(extract({ allowAvailableUninstall: true })).toBe(true);
    expect(extract({ allowAvailableUninstall: false })).toBe(false);
    expect(extract({ allowAvailableUninstall: 'true' })).toBeUndefined();
    expect(extract({})).toBeUndefined();
  });

  it('sends explicit allowAvailableUninstall without calling Graph GET', async () => {
    const graph = graphMock();
    const uploader = new IntuneUploader(config) as unknown as TestableUploader;

    await uploader.createWin32App(graph, packagingJob({ allowAvailableUninstall: true, sourceIntuneAppId: SOURCE_UUID }), 'pkg.intunewin');
    expect(graph.get).not.toHaveBeenCalled();
    expect(graph.post.mock.calls[0][1].allowAvailableUninstall).toBe(true);
  });

  it('inherits allowAvailableUninstall from Graph sourceIntuneAppId when omitted', async () => {
    const graph = graphMock();
    graph.get.mockResolvedValue({ '@odata.type': '#microsoft.graph.win32LobApp', allowAvailableUninstall: true });
    const uploader = new IntuneUploader(config) as unknown as TestableUploader;

    await uploader.createWin32App(graph, packagingJob({ sourceIntuneAppId: SOURCE_UUID }), 'pkg.intunewin');
    expect(graph.get).toHaveBeenCalledWith(`/deviceAppManagement/mobileApps/${SOURCE_UUID}`);
    expect(graph.post.mock.calls[0][1].allowAvailableUninstall).toBe(true);
  });

  it('falls back safely to omitted on Graph 404 or missing field', async () => {
    const graph404 = graphMock();
    graph404.get.mockRejectedValue(new Error('Graph API GET failed: 404 Not Found'));
    const uploader = new IntuneUploader(config) as unknown as TestableUploader;
    await uploader.createWin32App(graph404, packagingJob({ sourceIntuneAppId: SOURCE_UUID }), 'pkg.intunewin');
    expect('allowAvailableUninstall' in graph404.post.mock.calls[0][1]).toBe(false);

    const graphMissing = graphMock();
    graphMissing.get.mockResolvedValue({ '@odata.type': '#microsoft.graph.win32LobApp' });
    await uploader.createWin32App(graphMissing, packagingJob({ sourceIntuneAppId: SOURCE_UUID }), 'pkg.intunewin');
    expect('allowAvailableUninstall' in graphMissing.post.mock.calls[0][1]).toBe(false);
  });

  it('fails closed before POST on transient 503 or network error when inheriting from sourceIntuneAppId', async () => {
    const graph = graphMock();
    graph.get.mockRejectedValue(new Error('Graph API GET failed: 503 Service Unavailable'));
    const uploader = new IntuneUploader(config) as unknown as TestableUploader;

    await expect(
      uploader.createWin32App(graph, packagingJob({ sourceIntuneAppId: SOURCE_UUID }), 'pkg.intunewin')
    ).rejects.toThrow(/503/);
    expect(graph.post).not.toHaveBeenCalled();
  });
});
