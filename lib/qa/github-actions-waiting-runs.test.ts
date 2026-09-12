import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getGitHubActionsConfigMock } = vi.hoisted(() => ({
  getGitHubActionsConfigMock: vi.fn(),
}));

vi.mock('@/lib/github-actions', () => ({
  getGitHubActionsConfig: getGitHubActionsConfigMock,
}));

import { cancelStaleWaitingQaRuns } from './github-actions-waiting-runs';

beforeEach(() => {
  vi.clearAllMocks();
  getGitHubActionsConfigMock.mockReturnValue({
    token: 'secret-token',
    owner: 'example',
    workflowsRepo: 'workflows',
    ref: 'main',
  });
});

describe('cancelStaleWaitingQaRuns', () => {
  it('cancels only stale waiting dispatches for the protected QA branch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        workflow_runs: [
          {
            id: 101,
            status: 'waiting',
            event: 'workflow_dispatch',
            head_branch: 'main',
            created_at: '2026-09-12T11:49:00.000Z',
          },
          {
            id: 102,
            status: 'waiting',
            event: 'workflow_dispatch',
            head_branch: 'main',
            created_at: '2026-09-12T11:55:00.000Z',
          },
          {
            id: 103,
            status: 'waiting',
            event: 'push',
            head_branch: 'main',
            created_at: '2026-09-12T11:00:00.000Z',
          },
          {
            id: 104,
            status: 'waiting',
            event: 'workflow_dispatch',
            head_branch: 'feature',
            created_at: '2026-09-12T11:00:00.000Z',
          },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(cancelStaleWaitingQaRuns(
      new Date('2026-09-12T12:00:00.000Z'),
      fetchMock
    )).resolves.toEqual([101]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/actions/workflows/intune-qa.yml/runs?status=waiting&per_page=20'
    );
    expect(fetchMock.mock.calls[1][0]).toContain('/actions/runs/101/cancel');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST' });
  });

  it('tolerates a run completing before its cancellation request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        workflow_runs: [{
          id: 201,
          status: 'waiting',
          event: 'workflow_dispatch',
          head_branch: 'main',
          created_at: '2026-09-12T11:00:00.000Z',
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }));

    await expect(cancelStaleWaitingQaRuns(
      new Date('2026-09-12T12:00:00.000Z'),
      fetchMock
    )).resolves.toEqual([]);
  });

  it('fails closed when the waiting-run inventory cannot be trusted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));

    await expect(cancelStaleWaitingQaRuns(
      new Date('2026-09-12T12:00:00.000Z'),
      fetchMock
    )).rejects.toThrow('Could not inspect waiting QA workflows (503)');
  });
});
