import { beforeEach, describe, expect, it, vi } from 'vitest';

const github = vi.hoisted(() => ({
  getWorkflowRun: vi.fn(),
  cancelWorkflowRun: vi.fn(),
}));

vi.mock('@/lib/github-actions', () => ({
  isGitHubActionsConfigured: () => true,
  getWorkflowRun: github.getWorkflowRun,
  cancelWorkflowRun: github.cancelWorkflowRun,
  UNSTARTED_WORKFLOW_RUN_STATUSES: ['queued', 'waiting', 'pending', 'requested'],
}));

import { keepActuallyStaleJobs } from './stale-jobs';

const job = (overrides: Record<string, unknown> = {}) => ({
  id: 'job',
  github_run_id: '42',
  tenant_id: 'tenant-a',
  updated_at: new Date(Date.now() - 80 * 60 * 1000).toISOString(),
  ...overrides,
});

describe('keepActuallyStaleJobs', () => {
  beforeEach(() => {
    github.getWorkflowRun.mockReset();
    github.cancelWorkflowRun.mockReset();
    github.cancelWorkflowRun.mockResolvedValue({ success: false, status: 'not_cancellable', message: '' });
  });

  it('keeps running workflows alive', async () => {
    github.getWorkflowRun.mockResolvedValue({ status: 'in_progress' });
    expect(await keepActuallyStaleJobs([job()], { tenantsWithExecutingJobs: new Set() })).toEqual([]);
  });

  it('fails jobs whose workflow completed without a callback', async () => {
    github.getWorkflowRun.mockResolvedValue({ status: 'completed' });
    expect(await keepActuallyStaleJobs([job()])).toHaveLength(1);
  });

  it('leaves queued runs alone when the caller cannot tell whether they wait legitimately', async () => {
    github.getWorkflowRun.mockResolvedValue({ status: 'queued' });
    expect(await keepActuallyStaleJobs([job()])).toEqual([]);
    expect(github.cancelWorkflowRun).not.toHaveBeenCalled();
  });

  it('leaves queued runs alone while the tenant has an executing job ahead of them', async () => {
    github.getWorkflowRun.mockResolvedValue({ status: 'queued' });
    const result = await keepActuallyStaleJobs([job()], { tenantsWithExecutingJobs: new Set(['tenant-a']) });
    expect(result).toEqual([]);
    expect(github.cancelWorkflowRun).not.toHaveBeenCalled();
  });

  it('fails and cancels a run stuck in queued while nothing runs for its tenant', async () => {
    github.getWorkflowRun.mockResolvedValue({ status: 'queued' });
    const result = await keepActuallyStaleJobs([job()], { tenantsWithExecutingJobs: new Set(['tenant-b']) });
    expect(result).toHaveLength(1);
    expect(github.cancelWorkflowRun).toHaveBeenCalledWith('42');
  });

  it('keeps a stuck queued run without a tenant, since its queue cannot be checked', async () => {
    github.getWorkflowRun.mockResolvedValue({ status: 'queued' });
    const result = await keepActuallyStaleJobs([job({ tenant_id: null })], { tenantsWithExecutingJobs: new Set() });
    expect(result).toEqual([]);
  });
});
