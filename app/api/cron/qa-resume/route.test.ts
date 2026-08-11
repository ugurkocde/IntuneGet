import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createServerClientMock,
  getFeatureFlagsMock,
  handleAutoUpdateJobCompletionMock,
  ensureQaDemandMock,
  triggerPackagingWorkflowMock,
} = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  getFeatureFlagsMock: vi.fn(),
  handleAutoUpdateJobCompletionMock: vi.fn(),
  ensureQaDemandMock: vi.fn(),
  triggerPackagingWorkflowMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ createServerClient: createServerClientMock }));
vi.mock('@/lib/features', () => ({ getFeatureFlags: getFeatureFlagsMock }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => ({ app: { url: 'https://example.test' } }) }));
vi.mock('@/lib/github-actions', () => ({ triggerPackagingWorkflow: triggerPackagingWorkflowMock }));
vi.mock('@/lib/auto-update/cleanup', () => ({
  handleAutoUpdateJobCompletion: handleAutoUpdateJobCompletionMock,
}));
vi.mock('@/lib/qa/demand', () => ({ ensureQaDemand: ensureQaDemandMock }));

import { GET } from './route';

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not', 'order', 'limit', 'update']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

describe('GET /api/cron/qa-resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'secret';
    getFeatureFlagsMock.mockReturnValue({ localPackager: true });
  });

  it('atomically releases a waiting local-packager job after an exact QA pass', async () => {
    const job = {
      id: 'job-1',
      qa_candidate_id: 'candidate-1',
      execution_profile_sha256: 'A'.repeat(64),
      created_at: '2026-08-09T12:00:00Z',
    };
    const packagingUpdate = chain({ data: { id: 'job-1' }, error: null });
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          if (client.from.mock.calls.filter(([name]) => name === 'packaging_jobs').length === 1) {
            return chain({ data: [job], error: null });
          }
          return packagingUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-1',
              status: 'passed',
              failure_summary: null,
              package_profile_sha256: 'A'.repeat(64),
            },
            error: null,
          });
        }
        if (table === 'qa_package_results') {
          return chain({ data: { outcome: 'Passed' }, error: null });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 1, failed: 0, waiting: 0 });
    expect(packagingUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued',
      qa_completed_at: expect.any(String),
    }));
    expect(handleAutoUpdateJobCompletionMock).not.toHaveBeenCalled();
  });

  it('finalizes auto-update tracking when the required QA candidate fails', async () => {
    const job = {
      id: 'job-failed-qa',
      qa_candidate_id: 'candidate-failed',
      execution_profile_sha256: 'A'.repeat(64),
      created_at: '2026-08-09T12:00:00Z',
    };
    const packagingUpdate = chain({ data: { id: job.id }, error: null });
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          if (client.from.mock.calls.filter(([name]) => name === 'packaging_jobs').length === 1) {
            return chain({ data: [job], error: null });
          }
          return packagingUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-failed',
              status: 'failed',
              failure_summary: 'Installer remained interactive.',
              package_profile_sha256: 'A'.repeat(64),
            },
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 0, failed: 1, waiting: 0 });
    expect(packagingUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'qa_failed',
      status_message: 'Installer remained interactive.',
    }));
    expect(handleAutoUpdateJobCompletionMock).toHaveBeenCalledWith(
      job.id,
      'failed',
      'Installer remained interactive.'
    );
  });

  it('rebuilds and relinks a superseded exact QA profile without failing the upload job', async () => {
    const job = {
      id: 'job-superseded',
      qa_candidate_id: 'candidate-old',
      execution_profile_sha256: 'A'.repeat(64),
      status_message: 'Waiting',
      created_at: '2026-08-09T12:00:00Z',
      winget_id: 'Example.App',
      display_name: 'Example App',
      publisher: 'Example',
      version: '2.0.0',
      architecture: 'x64',
      installer_url: 'https://example.test/installer.msi',
      installer_sha256: 'C'.repeat(64),
      installer_type: 'wix',
      install_command: 'msiexec /i installer.msi /qn',
      uninstall_command: 'msiexec /x {11111111-1111-1111-1111-111111111111} /qn',
      install_scope: 'machine',
      package_config: { psadtConfig: {}, detectionRules: [] },
      is_auto_update: false,
    };
    ensureQaDemandMock.mockResolvedValue({
      state: 'waiting',
      candidateId: 'candidate-current',
      identity: {
        executionProfileSha256: 'B'.repeat(64),
        presentationProfileSha256: 'D'.repeat(64),
      },
    });
    const relinkUpdate = chain({ data: null, error: null });
    let packagingCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          packagingCall++;
          if (packagingCall === 1) return chain({ data: [job], error: null });
          return relinkUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-old',
              status: 'superseded',
              failure_summary: null,
              package_profile_sha256: 'A'.repeat(64),
            },
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 0, failed: 0, waiting: 1 });
    expect(ensureQaDemandMock).toHaveBeenCalledWith(client, expect.objectContaining({
      wingetId: 'Example.App',
      priority: 2000,
      demandSource: 'customer',
    }));
    expect(relinkUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      qa_candidate_id: 'candidate-current',
      execution_profile_sha256: 'B'.repeat(64),
      presentation_profile_sha256: 'D'.repeat(64),
    }));
  });

  it('rebuilds a legacy waiting job that has no QA candidate link', async () => {
    const job = {
      id: 'job-unlinked',
      qa_candidate_id: null,
      execution_profile_sha256: 'A'.repeat(64),
      status_message: 'Testing the app installation before upload',
      created_at: '2026-08-09T12:00:00Z',
      winget_id: 'Example.Legacy',
      display_name: 'Example Legacy',
      publisher: 'Example',
      version: '2.0.0',
      architecture: 'x64',
      installer_url: 'https://example.test/installer.exe',
      installer_sha256: 'C'.repeat(64),
      installer_type: 'exe',
      install_command: 'installer.exe /silent',
      uninstall_command: 'installer.exe /uninstall',
      install_scope: 'machine',
      package_config: { psadtConfig: {}, detectionRules: [] },
      is_auto_update: false,
    };
    ensureQaDemandMock.mockResolvedValue({
      state: 'waiting',
      candidateId: 'candidate-recovered',
      identity: {
        executionProfileSha256: 'B'.repeat(64),
        presentationProfileSha256: 'D'.repeat(64),
      },
    });
    const relinkUpdate = chain({ data: null, error: null });
    let packagingCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'packaging_jobs') throw new Error(`Unexpected table ${table}`);
        packagingCall++;
        if (packagingCall === 1) return chain({ data: [job], error: null });
        return relinkUpdate;
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 0, failed: 0, waiting: 1 });
    expect(ensureQaDemandMock).toHaveBeenCalledWith(client, expect.objectContaining({
      wingetId: 'Example.Legacy',
      priority: 2000,
      demandSource: 'customer',
    }));
    expect(relinkUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      qa_candidate_id: 'candidate-recovered',
      execution_profile_sha256: 'B'.repeat(64),
      presentation_profile_sha256: 'D'.repeat(64),
    }));
    expect(client.from).not.toHaveBeenCalledWith('qa_candidates');
  });

  it('finalizes auto-update tracking when packaging dispatch fails after QA passes', async () => {
    getFeatureFlagsMock.mockReturnValue({ localPackager: false });
    triggerPackagingWorkflowMock.mockRejectedValue(new Error('GitHub dispatch unavailable'));
    const job = {
      id: 'job-dispatch-failed',
      qa_candidate_id: 'candidate-passed',
      execution_profile_sha256: 'B'.repeat(64),
      created_at: '2026-08-09T12:00:00Z',
      winget_id: 'Example.App',
      display_name: 'Example App',
      version: '1.0.0',
      installer_url: 'https://example.test/installer.exe',
      installer_type: 'exe',
      install_command: 'installer.exe /silent',
      package_config: {},
    };
    const claimUpdate = chain({ data: { id: job.id }, error: null });
    const failedUpdate = chain({ data: { id: job.id }, error: null });
    let packagingCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          packagingCall++;
          if (packagingCall === 1) return chain({ data: [job], error: null });
          if (packagingCall === 2) return claimUpdate;
          return failedUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-passed',
              status: 'passed',
              failure_summary: null,
              package_profile_sha256: 'B'.repeat(64),
            },
            error: null,
          });
        }
        if (table === 'qa_package_results') {
          return chain({ data: { outcome: 'Passed' }, error: null });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 0, failed: 1, waiting: 0 });
    expect(failedUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error_code: 'QA_RESUME_DISPATCH_FAILED',
      error_message: 'GitHub dispatch unavailable',
    }));
    expect(handleAutoUpdateJobCompletionMock).toHaveBeenCalledWith(
      job.id,
      'failed',
      'GitHub dispatch unavailable'
    );
  });
});
