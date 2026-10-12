import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getGitHubActionsConfigMock } = vi.hoisted(() => ({
  getGitHubActionsConfigMock: vi.fn(),
}));

vi.mock('@/lib/github-actions', () => ({
  getGitHubActionsConfig: getGitHubActionsConfigMock,
}));

import { isQaWorkflowRunCompleted } from './github-actions-run-status';

beforeEach(() => {
  vi.clearAllMocks();
  getGitHubActionsConfigMock.mockReturnValue({
    token: 'secret-token',
    owner: 'example',
    workflowsRepo: 'workflows',
    ref: 'main',
  });
});

function workflowRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 34748233863,
    status: 'completed',
    event: 'workflow_dispatch',
    head_branch: 'main',
    path: '.github/workflows/intune-qa.yml',
    ...overrides,
  };
}

describe('isQaWorkflowRunCompleted', () => {
  it('recognizes the completed protected QA workflow', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(workflowRun()), { status: 200 })
    );

    await expect(isQaWorkflowRunCompleted('34748233863', fetchMock)).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/example/workflows/actions/runs/34748233863'
    );
  });

  it('leaves a workflow that is still executing active', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(workflowRun({ status: 'in_progress' })), { status: 200 })
    );

    await expect(isQaWorkflowRunCompleted('34748233863', fetchMock)).resolves.toBe(false);
  });

  it.each([
    ['wrong workflow', { path: '.github/workflows/package-intunewin.yml' }],
    ['wrong branch', { head_branch: 'feature' }],
    ['wrong event', { event: 'push' }],
    ['wrong ID', { id: 34748233864 }],
  ])('fails closed for a %s response', async (_label, overrides) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(workflowRun(overrides)), { status: 200 })
    );

    await expect(isQaWorkflowRunCompleted('34748233863', fetchMock))
      .rejects.toThrow('GitHub returned an invalid QA workflow response');
  });

  it('fails closed when GitHub cannot provide the run', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));

    await expect(isQaWorkflowRunCompleted('34748233863', fetchMock))
      .rejects.toThrow('Could not inspect QA workflow 34748233863 (503)');
  });

  it.each(['', 'abc', '0', '-1', '9007199254740992'])('rejects an invalid run ID: %s', async (runId) => {
    await expect(isQaWorkflowRunCompleted(runId, vi.fn()))
      .rejects.toThrow(/invalid GitHub workflow run ID|safe integer range/);
  });
});
