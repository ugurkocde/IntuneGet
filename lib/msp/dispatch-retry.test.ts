import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceInProgressBatches, processPendingBatches } from './batch-orchestrator';
import { buildStoredJobWorkflowInputs } from '@/lib/auto-update/stored-job-workflow-inputs';
import { WorkflowDispatchRateLimitError, WorkflowDispatchUnconfirmedError } from '@/lib/workflow-dispatch-rate-limit';

const { createServerClient, getDatabase, triggerPackagingWorkflow } = vi.hoisted(() => ({
  createServerClient: vi.fn(), getDatabase: vi.fn(), triggerPackagingWorkflow: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ createServerClient }));
vi.mock('@/lib/db', () => ({ getDatabase }));
vi.mock('@/lib/github-actions', () => ({ isGitHubActionsConfigured: () => true, triggerPackagingWorkflow }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => ({ app: { url: 'https://example.com' } }) }));
vi.mock('@/lib/qa/maintenance', () => ({ isQaMaintenanceMode: () => false }));
vi.mock('@/lib/qa/gate', () => ({ enforceQaGate: async () => undefined, isQaGateError: () => false, describeQaGateError: () => '' }));
vi.mock('@/lib/curated-catalog/licence', () => ({ assertCuratedLicenceAccepted: async () => undefined, CuratedLicenceError: class extends Error {} }));
vi.mock('@/lib/catalog', () => ({ getCatalogSource: () => ({
  getAppDescription: async () => 'App',
  getLatestVersionInstallerInfo: async () => ({ installers: [{ Architecture: 'x64', InstallerUrl: 'https://example.com/test.exe',
    InstallerSha256: 'A'.repeat(64), InstallerType: 'exe', Scope: 'machine', InstallerSwitches: { Silent: '/S' } }] }),
}) }));
vi.mock('@/lib/msp/consent-verification', () => ({ verifyTenantConsent: async () => ({ verified: true }) }));

describe('MSP dispatch admission retries', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { status: 403, identity: true }, { status: 429, identity: true }, { status: 503, identity: true },
    { status: 403, identity: false }, { status: 503, identity: false }, { status: 401, identity: false },
  ])('persists a bounded disposition for $status with identity=$identity', async ({ status, identity: hasIdentity }) => {
    const batch = { id: 'batch', winget_id: 'Vendor.App', version: '2', display_name: 'App', architecture: 'x64', concurrency_limit: 1,
      created_by_user_id: 'msp-user', created_by_email: null };
    const item = { id: 'item', tenant_id: 'customer' };
    const itemChanges: Array<Record<string, unknown>> = [];
    const jobChanges: Array<Record<string, unknown>> = [];
    createServerClient.mockReturnValue({ from: (table: string) => {
      const result = { data: table === 'msp_batch_deployments' ? [batch] : [item], error: null, count: 0 };
      const builder = {
        select: () => builder, order: () => builder, limit: () => builder, eq: () => builder, is: () => builder,
        update: (value: Record<string, unknown>) => { if (table === 'msp_batch_deployment_items') itemChanges.push(value); if (table === 'packaging_jobs') jobChanges.push(value); return builder; },
        single: async () => ({ data: batch, error: null }),
        maybeSingle: async () => ({ data: item, error: null }),
        then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return builder;
    } });
    const create = vi.fn(async value => value);
    const update = vi.fn(async () => true);
    getDatabase.mockReturnValue({ jobs: { getApprovalFailures: vi.fn(async () => []), create, update } });
    const identity = hasIdentity ? 'a'.repeat(64) : undefined;
    triggerPackagingWorkflow.mockImplementation(async () => {
      if (status === 401) throw new Error('GitHub rejected the dispatch (401)');
      if (status === 503) throw new WorkflowDispatchUnconfirmedError(503, Date.now(), identity);
      throw new WorkflowDispatchRateLimitError(status, new Date(Date.now() + 120_000).toISOString(), identity);
    });

    await processPendingBatches();

    expect(create).toHaveBeenCalledTimes(1);
    const jobId = create.mock.calls[0][0].id;
    expect(triggerPackagingWorkflow).toHaveBeenCalledTimes(1);
    if (!hasIdentity) {
      expect(jobChanges).toContainEqual(expect.objectContaining({ status: 'failed' }));
      expect(itemChanges).toContainEqual(expect.objectContaining({ status: 'failed' }));
      expect(jobChanges.some(change => change.status === 'awaiting_qa')).toBe(false);
      return;
    }
    expect(jobChanges).toContainEqual(expect.objectContaining({
      status: 'awaiting_qa', completed_at: null,
      qa_resume_due_at: expect.any(String),
      error_details: expect.objectContaining({ workflow_dispatch_unconfirmed_identity: identity }),
    }));
    expect(itemChanges).toContainEqual(expect.objectContaining({ packaging_job_id: jobId, status: 'in_progress' }));
    expect(itemChanges.some(change => change.status === 'failed')).toBe(false);
    const saved = create.mock.calls[0][0];
    expect(saved.package_config).toBeDefined();
    expect(buildStoredJobWorkflowInputs(saved, saved.package_config, {
      callbackUrl: 'https://example.com/api/package/callback', qaOverride: false, sanitizeAssignments: true,
    })).toEqual(triggerPackagingWorkflow.mock.calls[0][0]);
  });

  it.each([
    { status: 'awaiting_qa', old: false, fails: false },
    { status: 'packaging', old: false, fails: false },
    { status: 'failed', old: false, fails: true },
    { status: 'uploading', old: false, fails: false },
    { status: 'uploading', old: true, fails: true },
    { status: 'blocked_upstream', old: false, fails: false },
  ])('reconciles stale batch items against linked $status jobs with old=$old', async ({ status, old, fails }) => {
    const failedIds: string[] = [];
    createServerClient.mockReturnValue({ from: (table: string) => {
      let stale = false;
      let writingFailure = false;
      const builder = {
        select: () => builder, order: () => builder, limit: () => builder, eq: () => builder,
        lt: () => { stale = true; return builder; },
        in: (_key: string, ids: string[]) => { if (writingFailure) failedIds.push(...ids); return builder; },
        update: (value: Record<string, unknown>) => { writingFailure = value.status === 'failed'; return builder; },
        single: async () => ({ data: { id: 'batch', concurrency_limit: 1 }, error: null }),
        then: (resolve: (r: unknown) => unknown) => Promise.resolve({ error: null, count: 1,
          data: table === 'msp_batch_deployments' ? [{ id: 'batch' }]
            : table === 'packaging_jobs' ? [{ id: 'job', status, packaging_started_at: new Date(Date.now() - (old ? 60 * 60_000 : 0)).toISOString() }]
              : stale ? [{ id: 'item', packaging_job_id: 'job' }] : [{ id: 'item', status: 'in_progress' }],
        }).then(resolve),
      };
      return builder;
    } });

    const result = await advanceInProgressBatches();

    expect(result.errors).toEqual([]);
    expect(failedIds).toEqual(fails ? ['item'] : []);
    expect(result.staleItemsRecovered).toBe(fails ? 1 : 0);
    expect(triggerPackagingWorkflow).not.toHaveBeenCalled();
  });
});
