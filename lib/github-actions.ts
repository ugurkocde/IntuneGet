/**
 * GitHub Actions Client
 * Triggers packaging workflows via GitHub REST API
 * Uses repository_dispatch to a private workflows repository
 */

export interface WorkflowInputs {
  jobId: string;
  tenantId: string;
  wingetId: string;
  displayName: string;
  publisher: string;
  version: string;
  installerUrl: string;
  installerSha256: string;
  installerType: string;
  silentSwitches: string;
  uninstallCommand: string;
  callbackUrl: string;
  psadtConfig?: string; // JSON-serialized PSADTConfig
  detectionRules?: string; // JSON-serialized DetectionRule[]
  assignments?: string; // JSON-serialized PackageAssignment[]
  installScope?: 'machine' | 'user'; // Install scope for per-user vs per-machine
}

export interface GitHubActionsConfig {
  token: string;
  owner: string;
  repo: string; // Public repo (for reference)
  workflowsRepo: string; // Private repo for workflows
  workflowFile: string;
  ref: string;
}

/**
 * Get GitHub Actions configuration from environment variables
 */
export function getGitHubActionsConfig(): GitHubActionsConfig {
  const token = process.env.GITHUB_PAT;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const workflowsRepo = process.env.GITHUB_WORKFLOWS_REPO;
  const workflowFile = process.env.GITHUB_WORKFLOW_FILE || 'package-intunewin.yml';
  const ref = process.env.GITHUB_REF || 'main';

  if (!token) {
    throw new Error('GITHUB_PAT environment variable is not set');
  }
  if (!owner) {
    throw new Error('GITHUB_OWNER environment variable is not set');
  }
  if (!workflowsRepo) {
    throw new Error('GITHUB_WORKFLOWS_REPO environment variable is not set');
  }

  return { token, owner, repo: repo || '', workflowsRepo, workflowFile, ref };
}

/**
 * Check if GitHub Actions is configured
 */
export function isGitHubActionsConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_PAT &&
    process.env.GITHUB_OWNER &&
    process.env.GITHUB_WORKFLOWS_REPO
  );
}

export interface TriggerResult {
  success: boolean;
  runId?: number;
  runUrl?: string;
}

/**
 * Trigger the packaging workflow via repository_dispatch to private workflows repo
 * Returns the workflow run ID if it can be captured
 */
export async function triggerPackagingWorkflow(
  inputs: WorkflowInputs,
  config?: GitHubActionsConfig
): Promise<TriggerResult> {
  const cfg = config || getGitHubActionsConfig();

  // Record time before triggering to help find the run
  const triggerTime = new Date();

  // Use repository_dispatch to trigger workflow in private repo
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.workflowsRepo}/dispatches`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      event_type: 'package-app',
      client_payload: {
        jobId: inputs.jobId,
        tenantId: inputs.tenantId,
        wingetId: inputs.wingetId,
        displayName: inputs.displayName,
        publisher: inputs.publisher,
        version: inputs.version,
        installerUrl: inputs.installerUrl,
        installerSha256: inputs.installerSha256,
        installerType: inputs.installerType,
        silentSwitches: inputs.silentSwitches,
        uninstallCommand: inputs.uninstallCommand,
        callbackUrl: inputs.callbackUrl,
        psadtConfig: inputs.psadtConfig || '{}',
        detectionRules: inputs.detectionRules || '[]',
        assignments: inputs.assignments || '[]',
        installScope: inputs.installScope || 'machine',
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to trigger GitHub Actions workflow: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  // repository_dispatch returns 204 No Content on success
  // Try to capture the run ID by polling recent runs in the private repo
  const runInfo = await captureWorkflowRunId(triggerTime, cfg);

  return {
    success: true,
    runId: runInfo?.id,
    runUrl: runInfo?.html_url,
  };
}

/**
 * Attempt to capture the workflow run ID after triggering
 * Polls recent runs to find one that started after the trigger time
 */
async function captureWorkflowRunId(
  triggerTime: Date,
  config: GitHubActionsConfig,
  maxAttempts: number = 5,
  delayMs: number = 2000
): Promise<{ id: number; html_url: string } | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Wait before checking (workflow takes time to appear)
    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      const runs = await getWorkflowRuns(config, { per_page: 5 });

      // Find a run that started after our trigger time
      for (const run of runs.workflow_runs) {
        const runCreatedAt = new Date(run.created_at);
        // Allow 30 second tolerance for clock differences
        if (runCreatedAt >= new Date(triggerTime.getTime() - 30000)) {
          return { id: run.id, html_url: run.html_url };
        }
      }
    } catch (error) {
      console.warn(`Failed to capture run ID (attempt ${attempt + 1}):`, error);
    }
  }

  console.warn('Could not capture workflow run ID after multiple attempts');
  return null;
}

/**
 * Get workflow runs from the private workflows repository
 */
export async function getWorkflowRuns(
  config?: GitHubActionsConfig,
  options?: {
    status?: 'queued' | 'in_progress' | 'completed';
    per_page?: number;
  }
): Promise<{
  total_count: number;
  workflow_runs: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    html_url: string;
    created_at: string;
    updated_at: string;
  }>;
}> {
  const cfg = config || getGitHubActionsConfig();
  const params = new URLSearchParams();

  if (options?.status) {
    params.set('status', options.status);
  }
  if (options?.per_page) {
    params.set('per_page', options.per_page.toString());
  }

  // Query the private workflows repository
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.workflowsRepo}/actions/runs?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get workflow runs: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  return response.json();
}

export interface CancelResult {
  success: boolean;
  status: 'cancelled' | 'not_cancellable' | 'not_found' | 'error';
  message: string;
}

/**
 * Cancel a workflow run by ID in the private workflows repository
 * Returns success/failure with appropriate handling:
 * - 202: Accepted (cancellation initiated)
 * - 409: Conflict (workflow already completed or not cancellable)
 * - 404: Not found
 */
export async function cancelWorkflowRun(
  runId: number | string,
  config?: GitHubActionsConfig
): Promise<CancelResult> {
  const cfg = config || getGitHubActionsConfig();
  // Cancel in private workflows repository
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.workflowsRepo}/actions/runs/${runId}/cancel`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (response.status === 202) {
      return {
        success: true,
        status: 'cancelled',
        message: 'Workflow cancellation initiated',
      };
    }

    if (response.status === 409) {
      return {
        success: false,
        status: 'not_cancellable',
        message: 'Workflow has already completed or cannot be cancelled',
      };
    }

    if (response.status === 404) {
      return {
        success: false,
        status: 'not_found',
        message: 'Workflow run not found',
      };
    }

    const errorText = await response.text();
    return {
      success: false,
      status: 'error',
      message: `Failed to cancel workflow: ${response.status} ${response.statusText} - ${errorText}`,
    };
  } catch (error) {
    return {
      success: false,
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error cancelling workflow',
    };
  }
}

/**
 * Get a specific workflow run by ID from the private workflows repository
 */
export async function getWorkflowRun(
  runId: number,
  config?: GitHubActionsConfig
): Promise<{
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}> {
  const cfg = config || getGitHubActionsConfig();
  // Get from private workflows repository
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.workflowsRepo}/actions/runs/${runId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get workflow run: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  return response.json();
}
