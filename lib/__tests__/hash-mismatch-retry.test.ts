import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tryHashMismatchRequeue } from '../hash-mismatch-retry';
import type { DatabaseAdapter, PackagingJob } from '@/lib/db/types';

const fetchAvailableVersionsLiveMock = vi.hoisted(() => vi.fn());
const getLiveInstallersMock = vi.hoisted(() => vi.fn());
const isGitHubActionsConfiguredMock = vi.hoisted(() => vi.fn());
const triggerPackagingWorkflowMock = vi.hoisted(() => vi.fn());
const getFeatureFlagsMock = vi.hoisted(() => vi.fn());
const getAppConfigMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/manifest-api', () => ({
  fetchAvailableVersionsLive: fetchAvailableVersionsLiveMock,
  getLiveInstallers: getLiveInstallersMock,
}));

vi.mock('@/lib/github-actions', () => ({
  isGitHubActionsConfigured: isGitHubActionsConfiguredMock,
  triggerPackagingWorkflow: triggerPackagingWorkflowMock,
}));

vi.mock('@/lib/features', () => ({
  getFeatureFlags: getFeatureFlagsMock,
}));

vi.mock('@/lib/config', () => ({
  getAppConfig: getAppConfigMock,
}));

const STALE_HASH = 'a'.repeat(64);
const FRESH_HASH = 'b'.repeat(64);

function makeJob(overrides: Partial<PackagingJob> = {}): PackagingJob {
  return {
    id: 'job-1',
    user_id: 'user-1',
    user_email: 'user@example.com',
    tenant_id: 'tenant-1',
    winget_id: 'Google.Chrome',
    version: '150.0.7871.47',
    display_name: 'Google Chrome',
    publisher: 'Google LLC',
    architecture: 'x64',
    installer_type: 'wix',
    installer_url: 'https://dl.google.com/chrome.msi',
    installer_sha256: STALE_HASH,
    install_command: 'msiexec /i "chrome.msi" /qn',
    uninstall_command: 'msiexec /x "{845446B1-C036-3E70-8EBC-7C053F89C0BA}" /qn /norestart',
    install_scope: 'machine',
    silent_switches: null,
    detection_rules: null,
    package_config: { sourceType: 'winget' },
    github_run_id: null,
    github_run_url: null,
    intunewin_url: null,
    intunewin_size_bytes: null,
    unencrypted_content_size: null,
    encryption_info: null,
    intune_app_id: null,
    intune_app_url: null,
    app_source: null,
    status: 'failed',
    status_message: 'failed',
    progress_percent: 0,
    progress_message: null,
    error_message: 'SHA256 hash mismatch',
    error_stage: 'download',
    error_category: 'validation',
    error_code: 'HASH_MISMATCH',
    error_details: null,
    warnings: null,
    packager_id: null,
    packager_heartbeat_at: null,
    claimed_at: null,
    packaging_started_at: null,
    packaging_completed_at: null,
    upload_started_at: null,
    completed_at: new Date().toISOString(),
    cancelled_at: null,
    cancelled_by: null,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeDb() {
  const update = vi.fn(
    async (id: string, data: Record<string, unknown>, _conditions?: Record<string, unknown>) => ({
      ...makeJob(),
      ...data,
      id,
    })
  );
  return { db: { jobs: { update } } as unknown as DatabaseAdapter, update };
}

const freshInstaller = {
  architecture: 'x64',
  url: 'https://dl.google.com/chrome.msi',
  sha256: FRESH_HASH,
  type: 'wix',
  scope: 'machine',
  productCode: '{11111111-2222-3333-4444-555555555555}',
};

beforeEach(() => {
  vi.clearAllMocks();
  getFeatureFlagsMock.mockReturnValue({ pipeline: true, localPackager: false });
  isGitHubActionsConfiguredMock.mockReturnValue(true);
  getAppConfigMock.mockReturnValue({ app: { url: 'https://www.intuneget.com' } });
  fetchAvailableVersionsLiveMock.mockResolvedValue(['150.0.7880.10', '150.0.7871.47']);
  getLiveInstallersMock.mockResolvedValue([freshInstaller]);
  triggerPackagingWorkflowMock.mockResolvedValue({});
});

describe('tryHashMismatchRequeue', () => {
  it('requeues with refreshed version, url, and hash', async () => {
    const { db, update } = makeDb();
    const result = await tryHashMismatchRequeue(db, makeJob());

    expect(result).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    const [id, data, condition] = update.mock.calls[0];
    expect(id).toBe('job-1');
    expect(data.status).toBe('packaging');
    expect(data.version).toBe('150.0.7880.10');
    expect(data.installer_sha256).toBe(FRESH_HASH);
    expect(data.error_code).toBeNull();
    expect((data.package_config as Record<string, unknown>).hashMismatchRetried).toBe(true);
    expect(condition).toEqual({ status: 'failed' });

    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(1);
    const inputs = triggerPackagingWorkflowMock.mock.calls[0][0];
    expect(inputs.jobId).toBe('job-1');
    expect(inputs.version).toBe('150.0.7880.10');
    expect(inputs.installerSha256).toBe(FRESH_HASH);
    expect(inputs.forceCreate).toBe(true);
    expect(inputs.callbackUrl).toBe('https://www.intuneget.com/api/package/callback');
    // Product code swapped into the uninstall command
    expect(inputs.uninstallCommand).toContain('{11111111-2222-3333-4444-555555555555}');
  });

  it('skips local packager mode', async () => {
    getFeatureFlagsMock.mockReturnValue({ pipeline: true, localPackager: true });
    const { db, update } = makeDb();

    expect(await tryHashMismatchRequeue(db, makeJob())).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('skips custom apps', async () => {
    const { db, update } = makeDb();
    const job = makeJob({
      winget_id: 'Custom.RustDesk.RustDesk',
      package_config: { sourceType: 'custom' },
    });

    expect(await tryHashMismatchRequeue(db, job)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('retries at most once', async () => {
    const { db, update } = makeDb();
    const job = makeJob({ package_config: { hashMismatchRetried: true } });

    expect(await tryHashMismatchRequeue(db, job)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('skips when winget-pkgs still has the same hash and version', async () => {
    fetchAvailableVersionsLiveMock.mockResolvedValue(['150.0.7871.47']);
    getLiveInstallersMock.mockResolvedValue([{ ...freshInstaller, sha256: STALE_HASH }]);
    const { db, update } = makeDb();

    expect(await tryHashMismatchRequeue(db, makeJob())).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('reverts the job to failed when dispatch fails', async () => {
    triggerPackagingWorkflowMock.mockRejectedValue(new Error('dispatch exploded'));
    const { db, update } = makeDb();

    expect(await tryHashMismatchRequeue(db, makeJob())).toBe(false);
    expect(update).toHaveBeenCalledTimes(2);
    const [, revertData, revertCondition] = update.mock.calls[1];
    expect(revertData.status).toBe('failed');
    expect(revertData.error_code).toBe('HASH_MISMATCH');
    // Original installer data restored, retry marker kept to prevent loops
    expect(revertData.version).toBe('150.0.7871.47');
    expect(revertData.installer_sha256).toBe(STALE_HASH);
    expect((revertData.package_config as Record<string, unknown>).hashMismatchRetried).toBe(true);
    expect(revertCondition).toEqual({ status: 'packaging' });
  });

  it('does not dispatch when the optimistic update loses', async () => {
    const { db } = makeDb();
    (db.jobs.update as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    expect(await tryHashMismatchRequeue(db, makeJob())).toBe(false);
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('never throws when the live manifest fetch fails', async () => {
    fetchAvailableVersionsLiveMock.mockRejectedValue(new Error('github down'));
    const { db, update } = makeDb();

    expect(await tryHashMismatchRequeue(db, makeJob())).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
