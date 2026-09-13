import { getGitHubActionsConfig } from '@/lib/github-actions';

const QA_WORKFLOW_PATH = '.github/workflows/intune-qa.yml';
const GITHUB_RUN_TIMEOUT_MS = 10_000;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/;

interface QaWorkflowRunResponse {
  id?: unknown;
  status?: unknown;
  event?: unknown;
  head_branch?: unknown;
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
 * Check whether the exact protected QA workflow run has already completed.
 * Candidate data is treated as untrusted: the returned run must match the
 * expected repository workflow, branch, event, and numeric ID.
 */
export async function isQaWorkflowRunCompleted(
  runId: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
    throw new Error('QA candidate contains an invalid GitHub workflow run ID.');
  }

  const numericRunId = Number(runId);
  if (!Number.isSafeInteger(numericRunId)) {
    throw new Error('QA candidate GitHub workflow run ID is outside the safe integer range.');
  }

  const config = getGitHubActionsConfig();
  const repositoryPath = `${encodeURIComponent(config.owner)}/${encodeURIComponent(config.workflowsRepo)}`;
  const response = await fetchImpl(
    `https://api.github.com/repos/${repositoryPath}/actions/runs/${numericRunId}`,
    {
      cache: 'no-store',
      headers: githubHeaders(config.token),
      signal: AbortSignal.timeout(GITHUB_RUN_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    throw new Error(`Could not inspect QA workflow ${numericRunId} (${response.status}).`);
  }

  const run = await response.json() as QaWorkflowRunResponse;
  if (
    run.id !== numericRunId ||
    run.event !== 'workflow_dispatch' ||
    run.head_branch !== config.ref ||
    run.path !== QA_WORKFLOW_PATH ||
    typeof run.status !== 'string'
  ) {
    throw new Error(`GitHub returned an invalid QA workflow response for run ${numericRunId}.`);
  }

  return run.status === 'completed';
}
