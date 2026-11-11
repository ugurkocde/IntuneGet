import { beforeEach, describe, expect, it, vi } from 'vitest';

type Filter = [string, ...unknown[]];

const state = vi.hoisted(() => ({
  localPackager: false,
  changedRows: true,
  cleanup: vi.fn(),
  recentJobs: [] as Array<Record<string, unknown>>,
  missingJobs: [] as Array<Record<string, unknown>>,
  findPackagingWorkflowRun: vi.fn(),
  getWorkflowRunAttemptJobs: vi.fn(),
  getCheckRunAnnotations: vi.fn(),
  staleJobs: [] as Array<Record<string, unknown>>,
  executingJobs: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ kind: 'select' | 'update'; filters: Filter[]; data?: Record<string, unknown> }>,
  getWorkflowRun: vi.fn(),
  cancelWorkflowRun: vi.fn(),
}));

vi.mock('@/lib/features', () => ({ getFeatureFlags: () => ({ localPackager: state.localPackager }) }));
vi.mock('@/lib/github-actions', () => ({
  WorkflowReadRateLimitError: class extends Error {},
  isGitHubActionsConfigured: () => true,
  getWorkflowRun: state.getWorkflowRun,
  findPackagingWorkflowRun: state.findPackagingWorkflowRun,
  getWorkflowRunAttemptJobs: state.getWorkflowRunAttemptJobs,
  getCheckRunAnnotations: state.getCheckRunAnnotations,
  getGitHubActionsConfig: () => ({ owner: 'ugurkocde', workflowsRepo: 'IntuneGet-Workflows', workflowFile: 'package-intunewin.yml', ref: 'main' }),
  cancelWorkflowRun: state.cancelWorkflowRun,
  UNSTARTED_WORKFLOW_RUN_STATUSES: ['queued', 'waiting', 'pending', 'requested'],
}));
vi.mock('@/lib/auto-update/cleanup', () => ({ handleAutoUpdateJobCompletion: state.cleanup }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const build = (kind: 'select' | 'update', data?: Record<string, unknown>) => {
        const entry = { kind, filters: [] as Filter[], data };
        state.queries.push(entry);
        const query: Record<string, unknown> = {};
        for (const op of ['in', 'lt', 'gte', 'eq', 'is', 'not', 'order', 'limit']) {
          query[op] = (...args: unknown[]) => { entry.filters.push([op, ...args]); return query; };
        }
        query.select = () => query;
        query.then = (resolve: (value: unknown) => unknown) => {
          if (kind === 'update') {
            if (!state.changedRows) return resolve({ data: [], error: null });
            const ids = entry.filters.find(([op, column]) => op === 'in' && column === 'id')?.[2] as string[];
            const single = entry.filters.find(([op, column]) => op === 'eq' && column === 'id')?.[2];
            return resolve({ data: ids ? ids.map((id) => ({ id })) : [{ id: single }], error: null });
          }
          if (entry.filters.some(([op, column]) => op === 'is' && column === 'github_run_id')) return resolve({ data: state.missingJobs, error: null });
          if (entry.filters.some(([op, column]) => op === 'eq' && column === 'github_run_id')) return resolve({ data: state.recentJobs.filter(j => j.github_run_id === entry.filters.find(([op, column]) => op === 'eq' && column === 'github_run_id')?.[2]).map(j => ({ id: j.id })), error: null });
          if (entry.filters.some(([op, column]) => op === 'not' && column === 'github_run_id')) return resolve({ data: state.recentJobs, error: null });
          const isExecutingLookup = entry.filters.some(([op, column]) => op === 'in' && column === 'tenant_id');
          return resolve({ data: isExecutingLookup ? state.executingJobs : state.staleJobs, error: null });
        };
        return query;
      };
      return {
        select: () => build('select'),
        update: (data: Record<string, unknown>) => build('update', data),
      };
    },
  }),
}));

process.env.CRON_SECRET = 'secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';

import { GET } from './route';
import { WorkflowReadRateLimitError } from '@/lib/github-actions';

const call = () => GET(new Request('http://localhost/api/cron/cleanup-stale-jobs', {
  headers: { authorization: 'Bearer secret' },
}));

describe('cleanup stale jobs cron', () => {
  beforeEach(() => {
    state.queries = [];
    state.localPackager = false;
    state.changedRows = true;
    state.cleanup.mockReset();
    state.recentJobs = [];
    state.missingJobs = [];
    state.findPackagingWorkflowRun.mockReset().mockResolvedValue(null);
    state.getWorkflowRunAttemptJobs.mockReset();
    state.getCheckRunAnnotations.mockReset();
    state.executingJobs = [];
    state.getWorkflowRun.mockReset();
    state.cancelWorkflowRun.mockReset();
    state.cancelWorkflowRun.mockResolvedValue({ success: false, status: 'not_cancellable', message: '' });
    // Issue #1403: the stuck job was already marked packaging while GitHub
    // kept its run queued and refused to cancel it.
    state.staleJobs = [{
      id: 'stuck',
      status: 'packaging',
      tenant_id: 'tenant-a',
      github_run_id: '37642391824',
      updated_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      is_auto_update: false,
    }];
    state.getWorkflowRun.mockResolvedValue({ status: 'queued' });
  });

  it('binds one exact recovered identity without changing status or redispatching', async () => {
    state.staleJobs = [];
    const started = new Date(Date.now() - 15 * 60_000).toISOString();
    state.missingJobs = [{ id: '4a4f09e2-cc56-4ad2-a264-38b8f91e79c7', status: 'packaging',
      github_run_id: null, packaging_started_at: started, updated_at: started,
      infrastructure_retry_count: 0, infrastructure_retry_run_id: null }];
    state.findPackagingWorkflowRun.mockResolvedValue({ id: 42 });
    expect(await (await call()).json()).toMatchObject({ reconciled: 1 });
    const update = state.queries.find(q => q.kind === 'update');
    expect(update?.data).toEqual({ github_run_id: '42', github_run_url: 'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/42' });
    expect(update?.filters).toEqual(expect.arrayContaining([
      ['is', 'github_run_id', null], ['eq', 'status', 'packaging'], ['eq', 'updated_at', started],
      ['eq', 'packaging_started_at', started], ['eq', 'infrastructure_retry_count', 0], ['is', 'infrastructure_retry_run_id', null],
    ]));
    expect(state.cancelWorkflowRun).not.toHaveBeenCalled();
    expect(state.cleanup).not.toHaveBeenCalled();
  });

  it.each(['retired', 'shared', 'lost revision', 'not found', 'quota'])('does not bind an unsafe missing identity: %s', async reason => {
    state.staleJobs = [];
    const started = new Date(Date.now() - 15 * 60_000).toISOString();
    state.missingJobs = [{ id: '4a4f09e2-cc56-4ad2-a264-38b8f91e79c7', status: 'packaging', github_run_id: null,
      packaging_started_at: started, updated_at: started, infrastructure_retry_count: 1,
      infrastructure_retry_run_id: reason === 'retired' ? '42' : '41' }];
    state.findPackagingWorkflowRun.mockResolvedValue(reason === 'not found' ? null : { id: 42 });
    if (reason === 'shared') state.recentJobs = [{ id: 'another-job', github_run_id: '42' }];
    if (reason === 'lost revision') state.changedRows = false;
    if (reason === 'quota') state.findPackagingWorkflowRun.mockRejectedValue(new WorkflowReadRateLimitError('60', null));
    expect(await (await call()).json()).toMatchObject({ reconciled: 0, deferred: reason === 'quota' });
    expect(state.queries.filter(q => q.kind === 'update')).toHaveLength(reason === 'lost revision' ? 1 : 0);
    expect(state.cleanup).not.toHaveBeenCalled();
  });

  it('reports an exact terminal run before the 75 minute stale window', async () => {
    const started = new Date(Date.now() - 15 * 60_000).toISOString();
    state.staleJobs = [];
    state.recentJobs = [{ id: '4a4f09e2-cc56-4ad2-a264-38b8f91e79c7', status: 'packaging',
      github_run_id: '42', updated_at: started, packaging_started_at: started,
      infrastructure_retry_count: 0, intune_app_id: null, cancelled_at: null, archived_at: null }];
    state.getWorkflowRun.mockResolvedValue({ id: 42, status: 'completed', conclusion: 'cancelled',
      repository: { full_name: 'ugurkocde/IntuneGet-Workflows' }, path: '.github/workflows/package-intunewin.yml',
      event: 'repository_dispatch', run_attempt: 1, display_title: 'Package 4a4f09e2-cc56-4ad2-a264-38b8f91e79c7',
      head_branch: 'main', created_at: started, updated_at: started });
    state.getWorkflowRunAttemptJobs.mockResolvedValue({ total_count: 1, jobs: [{ id: 101, run_id: 42,
      run_attempt: 1, status: 'completed', conclusion: 'cancelled', steps: [] }] });
    const body = await (await call()).json();
    expect(body.reconciled).toBe(1);
    expect(state.queries.find(q => q.kind === 'update')?.data).toMatchObject({ status: 'failed', error_code: 'WORKFLOW_ENDED_WITHOUT_RESULT' });
    expect(state.cancelWorkflowRun).not.toHaveBeenCalled();
  });

  it('fails a stuck job whose own packaging status is the only activity for its tenant', async () => {
    const response = await call();

    expect(await response.json()).toMatchObject({ cleaned: 1 });
    const lookup = state.queries.find((query) =>
      query.filters.some(([op, column]) => op === 'in' && column === 'tenant_id'));
    expect(lookup?.filters).toContainEqual(['gte', 'updated_at', expect.any(String)]);
    expect(state.cancelWorkflowRun).toHaveBeenCalledWith('37642391824');
    const update = state.queries.find((query) => query.kind === 'update');
    expect(update?.data).toMatchObject({ status: 'failed' });
    expect(update?.filters).toContainEqual(['lt', 'updated_at', expect.any(String)]);
  });

  it('keeps a queued run waiting behind a tenant job that is making progress', async () => {
    state.executingJobs = [{ tenant_id: 'tenant-a' }];

    expect(await (await call()).json()).toMatchObject({ cleaned: 0 });
    expect(state.cancelWorkflowRun).not.toHaveBeenCalled();
    expect(state.queries.some((query) => query.kind === 'update')).toBe(false);
  });
});


describe('once-only runner recovery integration', () => {
  beforeEach(() => {
    const started = new Date(Date.now() - 15 * 60_000).toISOString();
    state.queries = [];
    state.localPackager = false;
    state.changedRows = true;
    state.cleanup.mockReset();
    state.cancelWorkflowRun.mockReset();
    state.staleJobs = [];
    state.executingJobs = [];
    state.recentJobs = [{ id: '4a4f09e2-cc56-4ad2-a264-38b8f91e79c7', status: 'packaging', github_run_id: '42',
      updated_at: started, packaging_started_at: started, infrastructure_retry_count: 0,
      qa_candidate_id: 'candidate', execution_profile_sha256: 'a'.repeat(64), package_config: {},
      intune_app_id: null, cancelled_at: null, archived_at: null, is_auto_update: true }];
    state.getWorkflowRun.mockReset().mockResolvedValue({ id: 42, status: 'completed', conclusion: 'failure',
      repository: { full_name: 'ugurkocde/IntuneGet-Workflows' }, path: '.github/workflows/package-intunewin.yml',
      event: 'repository_dispatch', run_attempt: 1, display_title: 'Package 4a4f09e2-cc56-4ad2-a264-38b8f91e79c7',
      head_branch: 'main', created_at: started, updated_at: started });
    state.getWorkflowRunAttemptJobs.mockReset().mockResolvedValue({ total_count: 1, jobs: [{ id: 101, run_id: 42,
      run_attempt: 1, status: 'completed', conclusion: 'failure', steps: [],
      check_run_url: 'https://api.github.com/repos/ugurkocde/IntuneGet-Workflows/check-runs/101' }] });
    state.getCheckRunAnnotations.mockReset().mockResolvedValue([{ message: 'The self-hosted runner lost communication with the server.' }]);
  });
  it('claims a single retry with every observed identity and revision fence, not an Actions rerun', async () => {
    expect(await (await call()).json()).toMatchObject({ reconciled: 1, cleaned: 0 });
    const q = state.queries.find(q => q.kind === 'update')!;
    expect(q.data).toMatchObject({ status: 'awaiting_qa', infrastructure_retry_count: 1, infrastructure_retry_run_id: '42',
      github_run_id: null, github_run_url: null, packaging_started_at: null, error_code: null, completed_at: null });
    for (const f of [['eq', 'status', 'packaging'], ['eq', 'updated_at', state.recentJobs[0].updated_at],
      ['eq', 'github_run_id', '42'], ['eq', 'qa_candidate_id', 'candidate'], ['eq', 'execution_profile_sha256', 'a'.repeat(64)],
      ['eq', 'infrastructure_retry_count', 0], ['is', 'intune_app_id', null], ['is', 'cancelled_at', null], ['is', 'archived_at', null]]) {
      expect(q.filters).toContainEqual(f);
    }
    expect(state.getCheckRunAnnotations).toHaveBeenCalledWith(101, expect.any(Object), expect.any(Number));
    expect(state.cleanup).not.toHaveBeenCalled();
    expect(state.cancelWorkflowRun).not.toHaveBeenCalled();
  });
  it('fails honestly after the once-only budget is exhausted', async () => {
    state.recentJobs[0].infrastructure_retry_count = 1;
    expect(await (await call()).json()).toMatchObject({ reconciled: 1 });
    expect(state.queries.find(q => q.kind === 'update')?.data).toMatchObject({ status: 'failed', error_code: 'WORKFLOW_RUNNER_LOST' });
    expect(state.cleanup).toHaveBeenCalledTimes(1);
  });
  it('does not clean up or report a retry when a concurrent callback wins the CAS', async () => {
    state.changedRows = false;
    expect(await (await call()).json()).toMatchObject({ reconciled: 0 });
    expect(state.cleanup).not.toHaveBeenCalled();
  });
  it('stops on a quota refusal with no retry write or further workflow reads', async () => {
    state.getWorkflowRun.mockRejectedValue(new WorkflowReadRateLimitError('60', null));
    expect(await (await call()).json()).toMatchObject({ reconciled: 0, deferred: true });
    expect(state.queries.some(q => q.kind === 'update')).toBe(false);
    expect(state.getWorkflowRunAttemptJobs).not.toHaveBeenCalled();
  });
  it('never discovers a guessed run for an uncaptured job', async () => {
    state.recentJobs[0].github_run_id = null;
    expect(await (await call()).json()).toMatchObject({ reconciled: 0 });
    expect(state.getWorkflowRun).not.toHaveBeenCalled();
  });
  it('does not retry a run shared by another customer row', async () => {
    state.recentJobs.push({ ...state.recentJobs[0], id: 'another-job' });
    expect(await (await call()).json()).toMatchObject({ reconciled: 0 });
    expect(state.queries.some(q => q.kind === 'update')).toBe(false);
  });
  it('skips GitHub reconciliation for the local packager', async () => {
    state.localPackager = true;
    expect(await (await call()).json()).toMatchObject({ reconciled: 0 });
    expect(state.getWorkflowRun).not.toHaveBeenCalled();
  });
  it('bounds each pass to five workflow lookups even if a backend returns excess rows', async () => {
    state.recentJobs = Array.from({ length: 7 }, (_, i) => ({ ...state.recentJobs[0], id: i ? 'other-' + i : state.recentJobs[0].id }));
    await call();
    expect(state.getWorkflowRun).toHaveBeenCalledTimes(5);
  });
  it('does not retry after any step started and preserves the callback grace window', async () => {
    state.getWorkflowRunAttemptJobs.mockResolvedValue({ total_count: 1, jobs: [{ id: 101, run_id: 42, run_attempt: 1,
      status: 'completed', conclusion: 'failure', steps: [{ name: 'Set up job' }] }] });
    state.getWorkflowRun.mockResolvedValue({ ...(await state.getWorkflowRun()), updated_at: new Date().toISOString() });
    expect(await (await call()).json()).toMatchObject({ reconciled: 0 });
    expect(state.queries.some(q => q.kind === 'update')).toBe(false);
  });
});
