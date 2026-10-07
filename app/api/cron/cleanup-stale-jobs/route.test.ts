import { beforeEach, describe, expect, it, vi } from 'vitest';

type Filter = [string, ...unknown[]];

const state = vi.hoisted(() => ({
  staleJobs: [] as Array<Record<string, unknown>>,
  executingJobs: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ kind: 'select' | 'update'; filters: Filter[]; data?: Record<string, unknown> }>,
  getWorkflowRun: vi.fn(),
  cancelWorkflowRun: vi.fn(),
}));

vi.mock('@/lib/github-actions', () => ({
  isGitHubActionsConfigured: () => true,
  getWorkflowRun: state.getWorkflowRun,
  cancelWorkflowRun: state.cancelWorkflowRun,
  UNSTARTED_WORKFLOW_RUN_STATUSES: ['queued', 'waiting', 'pending', 'requested'],
}));
vi.mock('@/lib/auto-update/cleanup', () => ({ handleAutoUpdateJobCompletion: async () => undefined }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const build = (kind: 'select' | 'update', data?: Record<string, unknown>) => {
        const entry = { kind, filters: [] as Filter[], data };
        state.queries.push(entry);
        const query: Record<string, unknown> = {};
        for (const op of ['in', 'lt', 'gte', 'eq']) {
          query[op] = (...args: unknown[]) => { entry.filters.push([op, ...args]); return query; };
        }
        query.select = () => query;
        query.then = (resolve: (value: unknown) => unknown) => {
          if (kind === 'update') {
            const ids = entry.filters.find(([op, column]) => op === 'in' && column === 'id')?.[2] as string[];
            return resolve({ data: ids.map((id) => ({ id })), error: null });
          }
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

const call = () => GET(new Request('http://localhost/api/cron/cleanup-stale-jobs', {
  headers: { authorization: 'Bearer secret' },
}));

describe('cleanup stale jobs cron', () => {
  beforeEach(() => {
    state.queries = [];
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
