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
    { status: 429, identity: true, longDelay: true },
    { status: 503, identity: false, callbackWins: true },
  ])('persists a bounded disposition for $status with identity=$identity', async ({ status, identity: hasIdentity, longDelay = false, callbackWins = false }) => {
    const batch = { id: 'batch', winget_id: 'Vendor.App', version: '2', display_name: 'App', architecture: 'x64', concurrency_limit: 1,
      created_by_user_id: 'msp-user', created_by_email: null };
    const item = { id: 'item', tenant_id: 'customer' };
    const itemChanges: Array<Record<string, unknown>> = [];
    const jobChanges: Array<Record<string, unknown>> = [];
    let savedJob: Record<string, unknown> | undefined;
    const itemRow: Record<string, unknown> = { ...item, status: 'pending' };
    createServerClient.mockReturnValue({ from: (table: string) => {
      let change: Record<string, unknown> | undefined;
      const filters: Array<[string, unknown]> = [];
      const execute = () => {
        if (!change) return { data: table === 'msp_batch_deployments' ? [batch] : [itemRow], error: null, count: 0 };
        const row: Record<string, unknown> | undefined = table === 'packaging_jobs' ? savedJob : table === 'msp_batch_deployment_items' ? itemRow : batch;
        if (!row || !filters.every(([key, value]) => (row[key] ?? null) === value)) return { data: null, error: null };
        Object.assign(row, change);
        if (table === 'msp_batch_deployment_items') itemChanges.push(change);
        if (table === 'packaging_jobs') jobChanges.push(change);
        return { data: { id: row.id }, error: null };
      };
      const builder = {
        select: () => builder, order: () => builder, limit: () => builder,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
        is: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
        update: (value: Record<string, unknown>) => { change = value; return builder; },
        single: async () => ({ data: batch, error: null }),
        maybeSingle: async () => execute(),
        then: (resolve: (r: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
      };
      return builder;
    } });
    const create = vi.fn(async value => { savedJob = { ...value }; return value; });
    const update = vi.fn(async () => true);
    const getById = vi.fn(async () => savedJob);
    getDatabase.mockReturnValue({ jobs: { getApprovalFailures: vi.fn(async () => []), create, update, getById } });
    const identity = hasIdentity ? 'a'.repeat(64) : undefined;
    triggerPackagingWorkflow.mockImplementation(async () => {
      if (callbackWins && savedJob) savedJob.callback_run_id = '123';
      if (status === 401) throw new Error('GitHub rejected the dispatch (401)');
      if (status === 503) throw new WorkflowDispatchUnconfirmedError(503, Date.now(), identity);
      throw new WorkflowDispatchRateLimitError(status, new Date(Date.now() + (longDelay ? 66 * 60_000 : 120_000)).toISOString(), identity);
    });

    await processPendingBatches();

    expect(create).toHaveBeenCalledTimes(1);
    const jobId = create.mock.calls[0][0].id;
    expect(triggerPackagingWorkflow).toHaveBeenCalledTimes(1);
    if (callbackWins) {
      expect(itemRow.status).toBe('in_progress');
      expect(itemChanges.some(change => change.status === 'failed')).toBe(false);
      expect(jobChanges).toEqual([]);
      expect(getById).toHaveBeenCalledTimes(1);
      return;
    }
    if (!hasIdentity || longDelay) {
      expect(jobChanges).toContainEqual(expect.objectContaining({ status: 'failed' }));
      expect(itemChanges).toContainEqual(expect.objectContaining({ status: 'failed' }));
      expect(itemRow.status).toBe('failed');
      expect(getById).not.toHaveBeenCalled();
      expect(jobChanges.filter(change => change.status === 'failed')).toHaveLength(1);
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
    { status: 'queued', old: false, fails: false },
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
            : table === 'packaging_jobs' ? [{ id: 'job', status, packaging_started_at: status === 'queued' ? null : new Date(Date.now() - (old ? 60 * 60_000 : 0)).toISOString() }]
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
  it.each(['callback', 'link-error', 'lost-link', 'read-error', 'cancelled', 'persist-error', 'success'] as const)('keeps batch ownership safe on %s', async mode => {
    const batch = { id: 'batch', winget_id: 'Vendor.App', version: '2', display_name: 'App', architecture: 'x64', concurrency_limit: 1,
      created_by_user_id: 'msp-user', created_by_email: null };
    const item = { id: 'item', tenant_id: 'customer' };
    let linked = false;
    let linkedAtDispatch = false;
    const itemChanges: Array<Record<string, unknown>> = [];
    const jobChanges: Array<Record<string, unknown>> = [];
    createServerClient.mockReturnValue({ from: (table: string) => {
      let change: Record<string, unknown> | undefined;
      const result = () => {
        if (table === 'msp_batch_deployment_items' && change?.packaging_job_id) {
          if (mode === 'lost-link') return { data: null, error: null };
          if (mode === 'link-error') return { data: null, error: { code: '57014', message: 'synthetic write failure' } };
          linked = true;
          return { data: item, error: null };
        }
        if (table === 'packaging_jobs' && change) return { data: ['callback', 'read-error', 'cancelled'].includes(mode) ? null : { id: 'job' }, error: null };
        return { data: table === 'msp_batch_deployments' ? [batch] : [item], error: null, count: 0 };
      };
      const builder = {
        select: () => builder, order: () => builder, limit: () => builder, eq: () => builder, is: () => builder,
        update: (value: Record<string, unknown>) => { change = value; if (table === 'packaging_jobs') jobChanges.push(value); if (table === 'msp_batch_deployment_items') itemChanges.push(value); return builder; },
        single: async () => ({ data: batch, error: null }), maybeSingle: async () => result(),
        then: (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return builder;
    } });
    const create = vi.fn(async value => value);
    getDatabase.mockReturnValue({ jobs: { getApprovalFailures: vi.fn(async () => []), create,
      update: vi.fn(async () => { if (mode === 'persist-error') throw Error('synthetic persist failure'); return true; }),
      getById: vi.fn(async () => { if (mode === 'read-error') throw Error('synthetic read failure');
        return mode === 'cancelled' ? { status: 'cancelled', cancelled_at: '2026-11-16T00:00:00Z' } : { status: 'packaging', callback_run_id: '123', github_run_id: null }; }) } });
    triggerPackagingWorkflow.mockImplementation(async () => {
      linkedAtDispatch = linked;
      if (mode === 'success' || mode === 'persist-error') return { runId: 123, runUrl: 'https://example.com/run' };
      throw new WorkflowDispatchUnconfirmedError(503, Date.now(), 'a'.repeat(64));
    });
    await processPendingBatches();
    if (mode === 'link-error' || mode === 'lost-link') {
      expect(triggerPackagingWorkflow).not.toHaveBeenCalled();
      expect(jobChanges.some(c => c.status === 'awaiting_qa')).toBe(false);
      expect(jobChanges).toContainEqual(expect.objectContaining({ status: 'failed' }));
      expect(itemChanges).toHaveLength(1);
    } else {
      expect(triggerPackagingWorkflow).toHaveBeenCalledTimes(1);
      expect(linkedAtDispatch).toBe(true);
      expect(linked).toBe(true);
      expect(itemChanges.some(c => c.status === 'failed')).toBe(mode === 'cancelled');
      expect(itemChanges.filter(c => c.packaging_job_id)).toHaveLength(1);
      if (mode === 'persist-error') expect(jobChanges.some(c => c.status === 'failed')).toBe(false);
    }
  });

});
