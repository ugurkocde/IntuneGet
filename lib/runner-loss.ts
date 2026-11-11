/** Classify a bound packaging run without guessing its job or executing a retry. */
export interface RunnerLossJob {
  id: string;
  status: string;
  github_run_id: string | null;
  packaging_started_at: string | null;
  infrastructure_retry_count?: number;
  qa_candidate_id?: string | null;
  execution_profile_sha256?: string | null;
  package_config?: unknown;
  intune_app_id?: string | null;
  cancelled_at?: string | null;
  archived_at?: string | null;
}

export interface PackagingWorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  repository?: { full_name?: string };
  path?: string;
  event?: string;
  run_attempt?: number;
  display_title?: string;
  head_branch?: string;
}

export interface WorkflowAttemptJobs {
  total_count: number;
  jobs: Array<{
    id: number;
    run_id: number;
    run_attempt: number;
    status: string;
    conclusion: string | null;
    steps?: unknown[];
    check_run_url?: string;
  }>;
}

export interface RunnerLossExpected {
  owner: string;
  workflowsRepo: string;
  workflowFile: string;
  ref: string;
}

export function isExactPackagingRun(job: RunnerLossJob, run: PackagingWorkflowRun, expected: RunnerLossExpected): boolean {
  const started = Date.parse(job.packaging_started_at ?? '');
  const created = Date.parse(run.created_at);
  return /^[1-9]\d*$/.test(job.github_run_id ?? '') && Number.isSafeInteger(run.id)
    && String(run.id) === job.github_run_id
    && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(job.id)
    && run.repository?.full_name?.toLowerCase() === `${expected.owner}/${expected.workflowsRepo}`.toLowerCase()
    && run.path?.split('@')[0] === `.github/workflows/${expected.workflowFile}`
    && run.event === 'repository_dispatch' && run.run_attempt === 1
    && run.head_branch === expected.ref.replace(/^refs\/heads\//, '')
    && run.display_title === `Package ${job.id}`
    && Number.isFinite(started) && Number.isFinite(created)
    && created >= started - 60_000 && created <= started + 10 * 60_000;
}

export type RunnerLossDisposition = 'pending' | 'ambiguous' | 'retry_eligible' | 'terminal_no_steps' | 'terminal_steps_ran';

export function classifyRunnerLoss(
  job: RunnerLossJob,
  run: PackagingWorkflowRun,
  attempt: WorkflowAttemptJobs,
  annotations: Array<{ message: string }>,
  expected: RunnerLossExpected,
  sharedRunCount: number,
): RunnerLossDisposition {
  if (!isExactPackagingRun(job, run, expected)) return 'ambiguous';
  if (run.status !== 'completed' || run.conclusion === 'success') return 'pending';
  if (!['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(run.conclusion ?? '')) return 'ambiguous';
  if (!Array.isArray(attempt.jobs) || attempt.jobs.length === 0 || attempt.jobs.length > 100
    || !Number.isSafeInteger(attempt.total_count) || attempt.total_count !== attempt.jobs.length
    || new Set(attempt.jobs.map(j => j.id)).size !== attempt.jobs.length
    || attempt.jobs.some(j => !Number.isSafeInteger(j.id) || j.id <= 0 || j.run_id !== run.id
      || j.run_attempt !== 1 || j.status !== 'completed' || !Array.isArray(j.steps))) return 'ambiguous';
  if (attempt.jobs.some(j => j.steps!.length > 0)) return 'terminal_steps_ran';
  const config = job.package_config;
  const forceCreate = config !== null && typeof config === 'object' && !Array.isArray(config)
    && (config as Record<string, unknown>).forceCreate === true;
  const runnerLost = annotations.some(a => typeof a.message === 'string'
    && /\bself-hosted runner lost communication with the server\b/i.test(a.message));
  if (run.conclusion === 'failure' && runnerLost && job.status === 'packaging'
    && !!job.qa_candidate_id && /^[a-f0-9]{64}$/i.test(job.execution_profile_sha256 ?? '')
    && !forceCreate && !job.intune_app_id && !job.cancelled_at && !job.archived_at
    && job.infrastructure_retry_count === 0 && sharedRunCount === 1) return 'retry_eligible';
  return 'terminal_no_steps';
}
