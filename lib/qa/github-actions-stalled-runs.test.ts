import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getGitHubActionsConfigMock } = vi.hoisted(() => ({ getGitHubActionsConfigMock: vi.fn() }));
vi.mock('@/lib/github-actions', () => ({ getGitHubActionsConfig: getGitHubActionsConfigMock }));
import { cancelStaleWaitingQaRuns } from './github-actions-waiting-runs';

const now = new Date('2026-09-30T12:00:00Z');
const stale = { id: 101, status: 'queued', event: 'workflow_dispatch', head_branch: 'main',
  path: '.github/workflows/intune-qa.yml', created_at: '2026-09-24T17:57:36Z' };
const response = (body: unknown) => new Response(JSON.stringify(body));

beforeEach(() => {
  vi.clearAllMocks();
  getGitHubActionsConfigMock.mockReturnValue({ token: 'secret-token', owner: 'example', workflowsRepo: 'workflows', ref: 'main' });
});

function fixture(options: { run?: Record<string, unknown>; fresh?: Record<string, unknown>;
  jobs?: unknown; cancelStatus?: number } = {}) {
  const run = options.run || stale;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/runs?')) return response({ workflow_runs: url.includes(`status=${run.status}&`) ? [run] : [] });
    if (url.includes('/jobs?')) return response(options.jobs || { total_count: 0, jobs: [] });
    if (url.endsWith('/cancel')) return new Response(null, { status: options.cancelStatus || 202 });
    if (url.endsWith('/runs/101') && !init?.method) return response(options.fresh || run);
    throw new Error(`Unexpected request: ${url}`);
  });
}
const cancellations = (fetchMock: ReturnType<typeof fixture>) => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('cancelStaleWaitingQaRuns', () => {
  it.each(['queued', 'waiting'])('releases a stale %s concurrency owner only after identity and job checks', async status => {
    const fetchMock = fixture({ run: { ...stale, status } });
    expect(await cancelStaleWaitingQaRuns(now, fetchMock)).toEqual([101]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      'https://api.github.com/repos/example/workflows/actions/workflows/intune-qa.yml/runs?status=queued&per_page=20');
    expect(cancellations(fetchMock)).toHaveLength(1);
    expect(String(cancellations(fetchMock)[0][0])).toMatch(/\/actions\/runs\/101\/cancel$/);
  });
  it.each([
    { event: 'push' }, { head_branch: 'feature' }, { path: '.github/workflows/package.yml' },
    { id: -1 }, { created_at: 'invalid' }, { created_at: '2026-09-30T11:59:00Z' },
    { status: 'pending' }, { status: 'in_progress' },
  ])('never cancels unrelated, fresh, pending, or executing runs: %j', async change => {
    const fetchMock = fixture({ run: { ...stale, ...change } });
    expect(await cancelStaleWaitingQaRuns(now, fetchMock)).toEqual([]);
    expect(cancellations(fetchMock)).toHaveLength(0);
  });
  it.each([
    { status: 'in_progress', started_at: null },
    { status: 'completed', started_at: '2026-09-24T18:00:00Z' },
    { status: 'queued', started_at: '2026-09-24T18:00:00Z' },
    { status: 'unknown', started_at: null },
  ])('preserves execution and publishing evidence: %j', async job => {
    const fetchMock = fixture({ jobs: { total_count: 1, jobs: [job] } });
    expect(await cancelStaleWaitingQaRuns(now, fetchMock)).toEqual([]);
    expect(cancellations(fetchMock)).toHaveLength(0);
  });
  it('rechecks the exact run to avoid cancelling a job that has just started', async () => {
    const fetchMock = fixture({ fresh: { ...stale, status: 'in_progress' } });
    expect(await cancelStaleWaitingQaRuns(now, fetchMock)).toEqual([]);
    expect(cancellations(fetchMock)).toHaveLength(0);
  });
  it.each([404, 409])('tolerates cancellation races (%s)', async cancelStatus => {
    expect(await cancelStaleWaitingQaRuns(now, fixture({ cancelStatus }))).toEqual([]);
  });
  it('rejects incomplete job inventories and provider errors without cancellation', async () => {
    const fetchMock = fixture({ jobs: { total_count: 2, jobs: [] } });
    await expect(cancelStaleWaitingQaRuns(now, fetchMock)).rejects.toThrow('incomplete QA job evidence');
    expect(cancellations(fetchMock)).toHaveLength(0);
    await expect(cancelStaleWaitingQaRuns(now, vi.fn(async () => new Response('', { status: 503 }))))
      .rejects.toThrow('Could not inspect waiting QA workflows (503)');
    await expect(cancelStaleWaitingQaRuns(now, fixture({ cancelStatus: 403 })))
      .rejects.toThrow('Could not cancel stale waiting QA workflow 101 (403)');
  });
});
