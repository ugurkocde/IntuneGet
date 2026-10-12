import { getGitHubActionsConfig } from '@/lib/github-actions';

const QA_WORKFLOW_FILE = 'intune-qa.yml';
const QA_WORKFLOW_PATH = `.github/workflows/${QA_WORKFLOW_FILE}`;
const STALE_WAITING_RUN_MS = 10 * 60 * 1000;
const MAX_WAITING_RUNS = 20;

interface QaWorkflowRun {
  id?: unknown;
  status?: unknown;
  event?: unknown;
  head_branch?: unknown;
  created_at?: unknown;
  path?: unknown;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * An orphaned queued run can own the workflow concurrency slot just like an
 * environment-waiting run. Inspect both inventories, but never cancel an
 * executing/publishing run or the pending workflow waiting behind the owner.
 * Revalidate identity and state immediately before cancellation.
 */
export async function cancelStaleWaitingQaRuns(
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch
): Promise<number[]> {
  const config = getGitHubActionsConfig();
  const repositoryPath = `${encodeURIComponent(config.owner)}/${encodeURIComponent(config.workflowsRepo)}`;
  const workflowPath = encodeURIComponent(QA_WORKFLOW_FILE);
  const apiBase = `https://api.github.com/repos/${repositoryPath}`;
  async function get(path: string) {
    const response = await fetchImpl(`${apiBase}${path}`, {
      cache: 'no-store',
      headers: githubHeaders(config.token),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Could not inspect waiting QA workflows (${response.status}).`);
    return response.json();
  }
  const staleBefore = now.getTime() - STALE_WAITING_RUN_MS;
  function isStale(run: QaWorkflowRun) {
    const createdAt = typeof run.created_at === 'string' ? Date.parse(run.created_at) : Number.NaN;
    return ['waiting', 'queued'].includes(String(run.status)) &&
      run.event === 'workflow_dispatch' && run.head_branch === config.ref &&
      run.path === QA_WORKFLOW_PATH && Number.isSafeInteger(run.id) && Number(run.id) > 0 &&
      Number.isFinite(createdAt) && createdAt <= staleBefore;
  }
  const cancelledRunIds: number[] = [];
  for (const status of ['waiting', 'queued']) {
    const query = new URLSearchParams({ status, per_page: String(MAX_WAITING_RUNS) });
    const payload = await get(`/actions/workflows/${workflowPath}/runs?${query}`);
    if (!Array.isArray(payload?.workflow_runs)) {
      throw new Error('GitHub returned an invalid waiting-workflow response.');
    }
    for (const run of (payload.workflow_runs as QaWorkflowRun[]).filter(isStale)) {
      const runId = run.id as number;
      const jobs = await get(`/actions/runs/${runId}/jobs?filter=latest&per_page=100`);
      if (!Array.isArray(jobs?.jobs) || !Number.isInteger(jobs.total_count) ||
          jobs.total_count !== jobs.jobs.length || jobs.total_count > 100) {
        throw new Error('GitHub returned incomplete QA job evidence.');
      }
      // Preserve any execution or completed lifecycle evidence. In particular,
      // a queued publisher after a successful VM test belongs to recovery.
      if (jobs.jobs.some((job: { status?: string; started_at?: string | null }) =>
        !['queued', 'waiting', 'pending'].includes(job.status || '') || job.started_at)) continue;
      const fresh = await get(`/actions/runs/${runId}`);
      if (!fresh || fresh.id !== runId || !isStale(fresh)) continue;
      const cancellation = await fetchImpl(`${apiBase}/actions/runs/${runId}/cancel`, {
        method: 'POST', headers: githubHeaders(config.token), signal: AbortSignal.timeout(10_000),
      });
      if (cancellation.status === 202) {
        cancelledRunIds.push(runId);
        continue;
      }
      if (cancellation.status === 404 || cancellation.status === 409) continue;
      throw new Error(`Could not cancel stale waiting QA workflow ${runId} (${cancellation.status}).`);
    }
  }
  return cancelledRunIds;
}
