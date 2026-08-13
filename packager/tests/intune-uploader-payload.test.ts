import { describe, expect, it, vi } from 'vitest';
import type { PackagerConfig } from '../src/config';
import { IntuneUploader } from '../src/intune-uploader';
import type { PackagingJob } from '../src/job-poller';

type GraphMock = {
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

type TestableUploader = {
  createWin32App(graphClient: GraphMock, job: PackagingJob, packageFileName: string): Promise<{ id: string }>;
  addRequirementRules(graphClient: GraphMock, appId: string, job: PackagingJob): Promise<void>;
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

function packagingJob(overrides: Partial<PackagingJob> = {}): PackagingJob {
  return {
    id: 'job-1',
    user_id: 'user-1',
    user_email: 'qa@example.com',
    tenant_id: 'tenant-1',
    winget_id: 'Contoso.Example',
    version: '1.2.3',
    display_name: 'Contoso Example',
    publisher: 'Contoso',
    architecture: 'x64',
    installer_type: 'exe',
    installer_url: 'https://example.com/setup.exe',
    installer_sha256: 'A'.repeat(64),
    install_command: '',
    uninstall_command: '',
    install_scope: 'machine',
    detection_rules: [],
    package_config: {},
    status: 'queued',
    progress_percent: 0,
    created_at: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

function graphMock(): GraphMock {
  return {
    post: vi.fn().mockResolvedValue({ id: 'app-1' }),
    get: vi.fn(),
    patch: vi.fn().mockResolvedValue(undefined),
  };
}

describe('IntuneUploader Win32 app payload', () => {
  it('creates the app with package metadata and unified detection rules', async () => {
    const graph = graphMock();
    const uploader = new IntuneUploader(config) as unknown as TestableUploader;
    const job = packagingJob({
      detection_rules: [
        {
          type: 'file',
          path: '%ProgramFiles%\\Contoso',
          fileOrFolderName: 'example.exe',
          detectionType: 'notExists',
        },
        {
          type: 'registry',
          keyPath: 'HKEY_LOCAL_MACHINE\\Software\\Contoso',
          valueName: 'Version',
          detectionType: 'version',
          operator: 'greaterThanOrEqual',
          detectionValue: '1.2.3',
        },
        { type: 'msi', productCode: '{00000000-0000-0000-0000-000000000001}' },
        { type: 'script', scriptContent: 'Write-Output installed' },
      ],
    });

    await uploader.createWin32App(graph, job, 'Invoke-AppDeployToolkit.intunewin');

    const body = graph.post.mock.calls[0][1] as Record<string, unknown>;
    const rules = body.rules as Array<Record<string, unknown>>;
    expect(body).toMatchObject({
      fileName: 'Invoke-AppDeployToolkit.intunewin',
      setupFilePath: 'Invoke-AppDeployToolkit.exe',
      minimumSupportedWindowsRelease: '1903',
    });
    expect(rules).toHaveLength(4);
    expect(rules.map((rule) => rule['@odata.type'])).toEqual([
      '#microsoft.graph.win32LobAppFileSystemRule',
      '#microsoft.graph.win32LobAppRegistryRule',
      '#microsoft.graph.win32LobAppProductCodeRule',
      '#microsoft.graph.win32LobAppPowerShellScriptRule',
    ]);
    expect(rules.every((rule) => rule.ruleType === 'detection')).toBe(true);
    expect(rules[0]).toMatchObject({
      operationType: 'doesNotExist',
      operator: 'notConfigured',
    });
    expect(rules[1]).toMatchObject({
      operationType: 'version',
      operator: 'greaterThanOrEqual',
      comparisonValue: '1.2.3',
    });
    expect(rules[3].scriptContent).toBe(
      Buffer.from('Write-Output installed').toString('base64'),
    );
  });

  it('uses a unified fallback detection rule when none are configured', async () => {
    const graph = graphMock();
    const uploader = new IntuneUploader(config) as unknown as TestableUploader;

    await uploader.createWin32App(
      graph,
      packagingJob(),
      'Invoke-AppDeployToolkit.intunewin',
    );

    const rules = graph.post.mock.calls[0][1].rules as Array<Record<string, unknown>>;
    expect(rules).toEqual([
      expect.objectContaining({
        '@odata.type': '#microsoft.graph.win32LobAppFileSystemRule',
        ruleType: 'detection',
        operationType: 'exists',
      }),
    ]);
  });

  it('appends requirement rules while preserving existing detection rules', async () => {
    const graph = graphMock();
    const detectionRule = { ruleType: 'detection', operationType: 'exists' };
    const requirementRule = { ruleType: 'requirement', operationType: 'exists' };
    graph.get.mockResolvedValue({ rules: [detectionRule] });
    const uploader = new IntuneUploader(config) as unknown as TestableUploader;

    await uploader.addRequirementRules(
      graph,
      'app-1',
      packagingJob({ package_config: { requirementRules: [requirementRule] } }),
    );

    expect(graph.get).toHaveBeenCalledOnce();
    expect(graph.patch).toHaveBeenCalledWith('/deviceAppManagement/mobileApps/app-1', {
      '@odata.type': '#microsoft.graph.win32LobApp',
      rules: [detectionRule, requirementRule],
    });
  });

  it('skips the post-create read and patch when no requirement rules exist', async () => {
    const graph = graphMock();
    const uploader = new IntuneUploader(config) as unknown as TestableUploader;

    await uploader.addRequirementRules(graph, 'app-1', packagingJob());

    expect(graph.get).not.toHaveBeenCalled();
    expect(graph.patch).not.toHaveBeenCalled();
  });
});
