import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  updates: [] as Array<{ data: Record<string, unknown>; filters: Array<[string, ...unknown[]]> }>,
  cancelWorkflowRun: vi.fn(),
  getWorkflowRun: vi.fn(),
  deleteById: vi.fn(),
  updatedRows: [{ id: 'job' }] as Array<{ id: string }>,
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: async () => ({ userId: 'user', userEmail: 'admin@example.test' }),
}));
vi.mock('@/lib/github-actions', () => ({
  isGitHubActionsConfigured: () => true,
  cancelWorkflowRun: state.cancelWorkflowRun,
  getWorkflowRun: state.getWorkflowRun,
  UNSTARTED_WORKFLOW_RUN_STATUSES: ['queued', 'waiting', 'pending', 'requested'],
}));
vi.mock('@/lib/auto-update/cleanup', () => ({ handleAutoUpdateJobCompletion: async () => undefined }));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({ jobs: { deleteById: state.deleteById } }) }));
vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: state.job, error: null }) }) }),
      update: (data: Record<string, unknown>) => {
        const entry = { data, filters: [] as Array<[string, ...unknown[]]> };
        state.updates.push(entry);
        const query = {
          eq: (...args: unknown[]) => { entry.filters.push(['eq', ...args]); return query; },
          not: (...args: unknown[]) => { entry.filters.push(['not', ...args]); return query; },
          select: () => query,
          then: (resolve: (value: { data: Array<{ id: string }>; error: null }) => unknown) =>
            resolve({ data: state.updatedRows, error: null }),
        };
        return query;
      },
    }),
  }),
}));

import { POST } from './route';

const call = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/package/cancel', {
  method: 'POST',
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}));

describe('cancel packaging job', () => {
  beforeEach(() => {
    state.updates = [];
    state.cancelWorkflowRun.mockReset();
    state.getWorkflowRun.mockReset();
    state.updatedRows = [{ id: 'job' }];
    state.deleteById.mockReset();
  });

  it('cancels a job waiting on QA without a workflow run and locks on its status', async () => {
    state.job = { id: 'job', user_id: 'user', status: 'awaiting_qa', github_run_id: null };
    const response = await call({ jobId: 'job' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, githubCancelled: null });
    expect(state.cancelWorkflowRun).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].data).toMatchObject({
      status: 'cancelled',
      error_message: 'Job cancelled by user while waiting for QA',
    });
    expect(state.updates[0].filters).toContainEqual(['eq', 'status', 'awaiting_qa']);
  });

  it('archives a QA failed job on dismiss', async () => {
    state.job = { id: 'job', user_id: 'user', status: 'qa_failed' };
    const response = await call({ jobId: 'job', dismiss: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, archived: true });
    expect(state.deleteById).toHaveBeenCalledWith('job');
  });

  it('still refuses to cancel a deployed job', async () => {
    state.job = { id: 'job', user_id: 'user', status: 'deployed' };
    expect((await call({ jobId: 'job' })).status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it('cancels a queued job whose GitHub run never started and cannot be cancelled there', async () => {
    state.job = { id: 'job', user_id: 'user', status: 'queued', github_run_id: '37642391824' };
    state.cancelWorkflowRun.mockResolvedValue({ success: false, status: 'not_cancellable', message: 'no' });
    state.getWorkflowRun.mockResolvedValue({ status: 'queued' });

    const response = await call({ jobId: 'job' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, githubCancelled: false });
    expect(state.getWorkflowRun).toHaveBeenCalledWith(37642391824);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].data).toMatchObject({ status: 'cancelled' });
    expect(state.updates[0].filters).toContainEqual(['eq', 'status', 'queued']);
  });

  it('still refuses when GitHub cannot cancel a run that is already executing', async () => {
    state.job = { id: 'job', user_id: 'user', status: 'packaging', github_run_id: '7' };
    state.cancelWorkflowRun.mockResolvedValue({ success: false, status: 'not_cancellable', message: 'no' });
    state.getWorkflowRun.mockResolvedValue({ status: 'in_progress' });

    expect((await call({ jobId: 'job' })).status).toBe(409);
    expect(state.updates).toHaveLength(0);
  });

  it('still refuses when the run state cannot be read after GitHub rejects cancellation', async () => {
    state.job = { id: 'job', user_id: 'user', status: 'queued', github_run_id: '7' };
    state.cancelWorkflowRun.mockResolvedValue({ success: false, status: 'not_cancellable', message: 'no' });
    state.getWorkflowRun.mockRejectedValue(new Error('rate limited'));

    expect((await call({ jobId: 'job' })).status).toBe(409);
    expect(state.updates).toHaveLength(0);
  });

  it('reports a conflict when the job changed status before the cancel update', async () => {
    state.job = { id: 'job', user_id: 'user', status: 'queued', github_run_id: '7' };
    state.cancelWorkflowRun.mockResolvedValue({ success: false, status: 'not_cancellable', message: 'no' });
    state.getWorkflowRun.mockResolvedValue({ status: 'queued' });
    state.updatedRows = [];

    const response = await call({ jobId: 'job' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ retryable: true });
  });
});
