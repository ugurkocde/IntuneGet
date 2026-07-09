/**
 * Shared constants for stale packaging job cleanup.
 * Used by the cleanup cron (app/api/cron/cleanup-stale-jobs) and the
 * read-side self-healing in the package status route (app/api/package).
 */

import { getWorkflowRun, isGitHubActionsConfigured } from '@/lib/github-actions';

// The workflow has a 60-minute timeout. Allow callback delivery and GitHub API
// propagation time before classifying a job as stale.
export const STALE_JOB_TIMEOUT_MINUTES = 75;

export const INTERMEDIATE_STATES = ['queued', 'packaging', 'uploading'];

export const STALE_JOB_ERROR_MESSAGE = `Job timed out after ${STALE_JOB_TIMEOUT_MINUTES} minutes without progress. This may indicate a callback delivery failure or workflow crash.`;

interface ReconciliableJob {
  github_run_id?: string | null;
  updated_at: string;
}

/**
 * Exclude jobs whose GitHub workflow is still queued or running. When GitHub is
 * temporarily unavailable, defer failure until a second timeout window.
 */
export async function keepActuallyStaleJobs<T extends ReconciliableJob>(jobs: T[]): Promise<T[]> {
  if (!isGitHubActionsConfigured()) return jobs;

  const now = Date.now();
  const doubleTimeoutMs = STALE_JOB_TIMEOUT_MINUTES * 2 * 60 * 1000;
  const results = await Promise.all(jobs.map(async (job) => {
    if (!job.github_run_id) return job;
    try {
      const run = await getWorkflowRun(Number(job.github_run_id));
      return run.status === 'queued' || run.status === 'in_progress' ? null : job;
    } catch (error) {
      console.warn(`Could not reconcile workflow run ${job.github_run_id}:`, error);
      return now - new Date(job.updated_at).getTime() >= doubleTimeoutMs ? job : null;
    }
  }));

  return jobs.filter((_, index) => results[index] !== null);
}
