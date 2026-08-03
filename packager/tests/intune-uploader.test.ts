import { describe, expect, it, vi } from 'vitest';
import { IntuneUploader } from '../src/intune-uploader';
import type { PackagingJob } from '../src/job-poller';
import type { PackagerConfig } from '../src/config';

function makeJob(overrides: Partial<PackagingJob> = {}): PackagingJob {
  return {
    id: 'job-1',
    user_id: 'user-1',
    user_email: 'user@example.com',
    tenant_id: 'tenant-1',
    winget_id: 'Mozilla.Firefox',
    version: '152.0.5',
    display_name: 'Firefox',
    publisher: 'Mozilla',
    architecture: 'x64',
    installer_type: 'exe',
    installer_url: 'https://example.com/firefox.exe',
    installer_sha256: 'a'.repeat(64),
    install_command: 'setup.exe /S',
    uninstall_command: 'uninstall.exe /S',
    install_scope: 'system',
    detection_rules: [
      {
        type: 'registry',
        keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Mozilla_Firefox',
        valueName: 'Version',
        check32BitOn64System: false,
        detectionType: 'version',
        operator: 'greaterThanOrEqual',
        detectionValue: '152.0.5',
      },
    ],
    package_config: {},
    status: 'uploading',
    progress_percent: 90,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeConfig(): PackagerConfig {
  return {
    packagerId: 'packager-1',
    mode: 'api',
    supabase: { url: '', serviceRoleKey: '' },
    api: { url: 'https://intuneget.example.com', key: 'api-key' },
    azure: { clientId: 'client-1', clientSecret: 'secret', useManagedIdentity: false },
    polling: { interval: 5000, staleJobTimeout: 300000 },
    paths: { work: '/tmp/work', tools: '/tmp/tools' },
  };
}

describe('IntuneUploader.createWin32App (accessed via private-method cast)', () => {
  it('sends a non-empty rules array on the initial create call, not an empty array', async () => {
    // Regression: Graph rejects POST /deviceAppManagement/mobileApps with
    // "The Win32LobApp must have at least one detection rule specified" when
    // `rules` is empty at creation time. Detection rules were previously only
    // added via a PATCH several steps later (addDetectionRules), which is too
    // late - the create call itself must carry them.
    const postMock = vi.fn().mockResolvedValue({ id: 'app-1' });
    const graphClientStub = { post: postMock };

    const uploader = new IntuneUploader(makeConfig());
    const uploaderInternal = uploader as unknown as {
      fetchLargeIcon: (job: PackagingJob) => Promise<unknown>;
      createWin32App: (
        graphClient: typeof graphClientStub,
        job: PackagingJob,
        packageFileName: string
      ) => Promise<{ id: string }>;
    };
    vi.spyOn(uploaderInternal, 'fetchLargeIcon').mockResolvedValue(null);

    const job = makeJob();
    const result = await uploaderInternal.createWin32App(
      graphClientStub,
      job,
      'Invoke-AppDeployToolkit.intunewin'
    );

    expect(result.id).toBe('app-1');
    expect(postMock).toHaveBeenCalledTimes(1);
    const [path, body] = postMock.mock.calls[0];
    expect(path).toBe('/deviceAppManagement/mobileApps');
    const rules = (body as { rules: unknown[] }).rules;
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    // The unified `rules` collection takes win32LobAppRule types with an
    // explicit ruleType and operationType/comparisonValue - not the
    // win32LobApp*DetectionRule names or detectionType/detectionValue fields
    // of the deprecated `detectionRules` property. Same shape as
    // convertToGraphDetectionRule() in lib/intune-api.ts.
    expect(rules[0]).toEqual({
      '@odata.type': '#microsoft.graph.win32LobAppRegistryRule',
      ruleType: 'detection',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Mozilla_Firefox',
      valueName: 'Version',
      check32BitOn64System: false,
      operationType: 'version',
      operator: 'greaterThanOrEqual',
      comparisonValue: '152.0.5',
    });
  });

  it('sends the package file name as fileName, separate from setupFilePath', async () => {
    // Regression: Graph rejects the create call with "FileName for Win32 LOB
    // app cannot be empty" when the body carries setupFilePath but no
    // fileName. The two are different fields - fileName names the uploaded
    // .intunewin, setupFilePath the entry point inside it.
    const postMock = vi.fn().mockResolvedValue({ id: 'app-5' });
    const graphClientStub = { post: postMock };

    const uploader = new IntuneUploader(makeConfig());
    const uploaderInternal = uploader as unknown as {
      fetchLargeIcon: (job: PackagingJob) => Promise<unknown>;
      createWin32App: (
        graphClient: typeof graphClientStub,
        job: PackagingJob,
        packageFileName: string
      ) => Promise<{ id: string }>;
    };
    vi.spyOn(uploaderInternal, 'fetchLargeIcon').mockResolvedValue(null);

    await uploaderInternal.createWin32App(
      graphClientStub,
      makeJob(),
      'Invoke-AppDeployToolkit.intunewin'
    );

    const [, body] = postMock.mock.calls[0];
    expect(body).toMatchObject({
      fileName: 'Invoke-AppDeployToolkit.intunewin',
      setupFilePath: 'Invoke-AppDeployToolkit.exe',
    });
  });

  it('maps notExists to the doesNotExist operation type Graph expects', async () => {
    const postMock = vi.fn().mockResolvedValue({ id: 'app-3' });
    const graphClientStub = { post: postMock };

    const uploader = new IntuneUploader(makeConfig());
    const uploaderInternal = uploader as unknown as {
      fetchLargeIcon: (job: PackagingJob) => Promise<unknown>;
      createWin32App: (
        graphClient: typeof graphClientStub,
        job: PackagingJob,
        packageFileName: string
      ) => Promise<{ id: string }>;
    };
    vi.spyOn(uploaderInternal, 'fetchLargeIcon').mockResolvedValue(null);

    const job = makeJob({
      detection_rules: [
        {
          type: 'file',
          path: 'C:\\Program Files\\Mozilla Firefox',
          fileOrFolderName: 'firefox.exe',
          detectionType: 'notExists',
        },
      ],
    });
    await uploaderInternal.createWin32App(
      graphClientStub,
      job,
      'Invoke-AppDeployToolkit.intunewin'
    );

    const [, body] = postMock.mock.calls[0];
    expect((body as { rules: unknown[] }).rules[0]).toMatchObject({
      '@odata.type': '#microsoft.graph.win32LobAppFileSystemRule',
      ruleType: 'detection',
      operationType: 'doesNotExist',
      operator: 'notConfigured',
    });
  });

  it('base64-encodes script detection rules and marks them notConfigured', async () => {
    const postMock = vi.fn().mockResolvedValue({ id: 'app-4' });
    const graphClientStub = { post: postMock };

    const uploader = new IntuneUploader(makeConfig());
    const uploaderInternal = uploader as unknown as {
      fetchLargeIcon: (job: PackagingJob) => Promise<unknown>;
      createWin32App: (
        graphClient: typeof graphClientStub,
        job: PackagingJob,
        packageFileName: string
      ) => Promise<{ id: string }>;
    };
    vi.spyOn(uploaderInternal, 'fetchLargeIcon').mockResolvedValue(null);

    const job = makeJob({
      detection_rules: [{ type: 'script', scriptContent: 'Write-Output "ok"' }],
    });
    await uploaderInternal.createWin32App(
      graphClientStub,
      job,
      'Invoke-AppDeployToolkit.intunewin'
    );

    const [, body] = postMock.mock.calls[0];
    expect((body as { rules: unknown[] }).rules[0]).toEqual({
      '@odata.type': '#microsoft.graph.win32LobAppPowerShellScriptRule',
      ruleType: 'detection',
      scriptContent: Buffer.from('Write-Output "ok"').toString('base64'),
      enforceSignatureCheck: false,
      runAs32Bit: false,
      operationType: 'notConfigured',
    });
  });

  it('falls back to a default file-system detection rule when the job has none', async () => {
    const postMock = vi.fn().mockResolvedValue({ id: 'app-2' });
    const graphClientStub = { post: postMock };

    const uploader = new IntuneUploader(makeConfig());
    const uploaderInternal = uploader as unknown as {
      fetchLargeIcon: (job: PackagingJob) => Promise<unknown>;
      createWin32App: (
        graphClient: typeof graphClientStub,
        job: PackagingJob,
        packageFileName: string
      ) => Promise<{ id: string }>;
    };
    vi.spyOn(uploaderInternal, 'fetchLargeIcon').mockResolvedValue(null);

    const job = makeJob({ detection_rules: [] });
    await uploaderInternal.createWin32App(
      graphClientStub,
      job,
      'Invoke-AppDeployToolkit.intunewin'
    );

    const [, body] = postMock.mock.calls[0];
    const rules = (body as { rules: unknown[] }).rules;
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0]).toEqual({
      '@odata.type': '#microsoft.graph.win32LobAppFileSystemRule',
      ruleType: 'detection',
      path: '%ProgramFiles%',
      fileOrFolderName: 'Firefox',
      check32BitOn64System: false,
      operationType: 'exists',
      operator: 'notConfigured',
      comparisonValue: null,
    });
  });
});
