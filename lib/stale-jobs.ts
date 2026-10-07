/**
 * Shared constants for stale packaging job cleanup.
 * Used by the cleanup cron (app/api/cron/cleanup-stale-jobs) and the
 * read-side self-healing in the package status route (app/api/package).
 */

import {
  cancelWorkflowRun,
  getWorkflowRun,
  isGitHubActionsConfigured,
  UNSTARTED_WORKFLOW_RUN_STATUSES,
} from '@/lib/github-actions';

// The workflow has a 60-minute timeout. Allow callback delivery and GitHub API
// propagation time before classifying a job as stale.
export const STALE_JOB_TIMEOUT_MINUTES = 75;

export const INTERMEDIATE_STATES = ['queued', 'packaging', 'uploading'];

export const STALE_JOB_ERROR_MESSAGE = `Job timed out after ${STALE_JOB_TIMEOUT_MINUTES} minutes without progress. This may indicate a callback delivery failure or workflow crash.`;

interface ReconciliableJob {
  github_run_id?: string | null;
  tenant_id?: string | null;
  updated_at: string;
}

interface StaleJobOptions {
  /**
   * Tenants with a job that is packaging or uploading and has reported
   * progress within the timeout window. The workflow runs one job per tenant
   * at a time, so a queued run is only legitimately waiting while its tenant
   * has an executing job. Without this set, queued runs are never treated as
   * stale.
   */
  tenantsWithExecutingJobs?: ReadonlySet<string>;
}

/**
 * Exclude jobs whose GitHub workflow is still queued or running. When GitHub is
 * temporarily unavailable, defer failure until a second timeout window.
 *
 * A run that stays queued past the timeout while nothing else runs for its
 * tenant is stuck on GitHub's side (seen as runs that reject cancellation with
 * "has not been queued yet"). Those jobs are failed and their run is cancelled
 * on a best-effort basis.
 */
export async function keepActuallyStaleJobs<T extends ReconciliableJob>(
  jobs: T[],
  options: StaleJobOptions = {},
): Promise<T[]> {
  if (!isGitHubActionsConfigured()) return jobs;

  const now = Date.now();
  const doubleTimeoutMs = STALE_JOB_TIMEOUT_MINUTES * 2 * 60 * 1000;
  const results = await Promise.all(jobs.map(async (job) => {
    if (!job.github_run_id) return job;
    try {
      const run = await getWorkflowRun(Number(job.github_run_id));
      if (run.status === 'in_progress') return null;
      if (!UNSTARTED_WORKFLOW_RUN_STATUSES.includes(run.status)) return job;

      const executing = options.tenantsWithExecutingJobs;
      if (!executing || !job.tenant_id || executing.has(job.tenant_id)) return null;
      const result = await cancelWorkflowRun(job.github_run_id);
      if (result.status === 'error') {
        console.warn(`Could not cancel stuck workflow run ${job.github_run_id}: ${result.message}`);
      }
      return job;
    } catch (error) {
      console.warn(`Could not reconcile workflow run ${job.github_run_id}:`, error);
      return now - new Date(job.updated_at).getTime() >= doubleTimeoutMs ? job : null;
    }
  }));

  return jobs.filter((_, index) => results[index] !== null);
}
