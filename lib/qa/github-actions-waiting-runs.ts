import { getGitHubActionsConfig } from '@/lib/github-actions';

const QA_WORKFLOW_FILE = 'intune-qa.yml';
const STALE_WAITING_RUN_MS = 10 * 60 * 1000;
const MAX_WAITING_RUNS = 20;

interface QaWorkflowRun {
  id?: unknown;
  status?: unknown;
  event?: unknown;
  head_branch?: unknown;
  created_at?: unknown;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Cancel environment-waiting QA runs that can indefinitely own the workflow's
 * single-flight concurrency slot. Only the protected QA workflow, its expected
 * branch, and workflow_dispatch runs older than the public stalled threshold
 * are eligible. Pending and executing runs are deliberately untouched.
 */
export async function cancelStaleWaitingQaRuns(
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch
): Promise<number[]> {
  const config = getGitHubActionsConfig();
  const repositoryPath = `${encodeURIComponent(config.owner)}/${encodeURIComponent(config.workflowsRepo)}`;
  const workflowPath = encodeURIComponent(QA_WORKFLOW_FILE);
  const query = new URLSearchParams({ status: 'waiting', per_page: String(MAX_WAITING_RUNS) });
  const response = await fetchImpl(
    `https://api.github.com/repos/${repositoryPath}/actions/workflows/${workflowPath}/runs?${query}`,
    {
      cache: 'no-store',
      headers: githubHeaders(config.token),
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!response.ok) {
    throw new Error(`Could not inspect waiting QA workflows (${response.status}).`);
  }

  const payload = await response.json() as { workflow_runs?: unknown };
  if (!Array.isArray(payload.workflow_runs)) {
    throw new Error('GitHub returned an invalid waiting-workflow response.');
  }

  const staleBefore = now.getTime() - STALE_WAITING_RUN_MS;
  const staleRunIds = (payload.workflow_runs as QaWorkflowRun[])
    .filter((run) => {
      if (
        run.status !== 'waiting' ||
        run.event !== 'workflow_dispatch' ||
        run.head_branch !== config.ref ||
        !Number.isInteger(run.id)
      ) {
        return false;
      }
      const createdAt = typeof run.created_at === 'string' ? Date.parse(run.created_at) : Number.NaN;
      return Number.isFinite(createdAt) && createdAt <= staleBefore;
    })
    .map((run) => run.id as number);

  const cancelledRunIds: number[] = [];
  for (const runId of staleRunIds) {
    const cancellation = await fetchImpl(
      `https://api.github.com/repos/${repositoryPath}/actions/runs/${runId}/cancel`,
      {
        method: 'POST',
        headers: githubHeaders(config.token),
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (cancellation.status === 202) {
      cancelledRunIds.push(runId);
      continue;
    }
    // The run can complete between the list and cancellation requests.
    if (cancellation.status === 404 || cancellation.status === 409) continue;
    throw new Error(`Could not cancel stale waiting QA workflow ${runId} (${cancellation.status}).`);
  }

  return cancelledRunIds;
}
