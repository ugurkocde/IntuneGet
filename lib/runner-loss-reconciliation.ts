import type { SupabaseClient } from '@supabase/supabase-js';
import { isGitHubActionsConfigured, getGitHubActionsConfig, getWorkflowRun, getWorkflowRunAttemptJobs, getCheckRunAnnotations, findPackagingWorkflowRun, WorkflowReadRateLimitError } from './github-actions';
import { classifyRunnerLoss, isExactPackagingRun, type RunnerLossJob } from './runner-loss';
import { handleAutoUpdateJobCompletion } from './auto-update/cleanup';

/** One bounded pass through existing customer jobs, never an Actions rerun. */
export async function reconcileRunnerLosses(supabase: SupabaseClient): Promise<{ reconciled: number; deferred: boolean }> {
  const result = { reconciled: 0, deferred: false };
  if (!isGitHubActionsConfigured()) return result;
  const started = Date.now();
  const deadline = started + 20_000;
  const cutoff = new Date(started - 10 * 60_000).toISOString();
  const { data, error } = await supabase.from('packaging_jobs')
    .select('id,status,github_run_id,updated_at,packaging_started_at,infrastructure_retry_count,qa_candidate_id,execution_profile_sha256,package_config,intune_app_id,cancelled_at,archived_at,is_auto_update')
    .in('status', ['packaging', 'uploading']).not('github_run_id', 'is', null)
    .is('intune_app_id', null).is('cancelled_at', null).is('archived_at', null)
    .lt('updated_at', cutoff).order('updated_at', { ascending: true }).limit(5);
  // A deployment without the required migration keeps the existing stale path.
  if (error) return result;
  const expected = getGitHubActionsConfig();
  for (const raw of (data ?? []).slice(0, 5)) {
    if (Date.now() >= deadline) { result.deferred = true; break; }
    const job = raw as RunnerLossJob & { updated_at: string; is_auto_update?: boolean };
    if (!/^[1-9]\d*$/.test(job.github_run_id ?? '') || !Number.isSafeInteger(Number(job.github_run_id))) continue;
    const timeout = () => Math.max(1, Math.min(8_000, deadline - Date.now()));
    try {
      const run = await getWorkflowRun(Number(job.github_run_id), expected, timeout());
      if (!isExactPackagingRun(job, run, expected) || run.status !== 'completed' || run.conclusion === 'success') continue;
      const attempt = await getWorkflowRunAttemptJobs(run.id, expected, timeout());
      let annotations: Array<{ message: string }> = [];
      const failures = Array.isArray(attempt.jobs) ? attempt.jobs.filter(j => j.conclusion === 'failure') : [];
      if (failures.length === 1 && attempt.jobs.every(j => Array.isArray(j.steps) && j.steps.length === 0)) {
        const prefix = `https://api.github.com/repos/${expected.owner}/${expected.workflowsRepo}/check-runs/`;
        const url = failures[0].check_run_url;
        const id = typeof url === 'string' && url.startsWith(prefix) ? url.slice(prefix.length) : '';
        if (/^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))) {
          try { annotations = await getCheckRunAnnotations(Number(id), expected, timeout()); }
          catch (e) { if (e instanceof WorkflowReadRateLimitError) throw e; }
        }
      }
      if (Date.now() >= deadline) { result.deferred = true; break; }
      const { data: siblings, error: sharedError } = await supabase.from('packaging_jobs')
        .select('id').eq('github_run_id', job.github_run_id).limit(2);
      if (sharedError || !siblings || siblings.length !== 1 || siblings[0].id !== job.id) continue;
      const disposition = classifyRunnerLoss(job, run, attempt, annotations, expected, siblings.length);
      if (disposition === 'ambiguous' || disposition === 'pending') continue;
      if (disposition === 'terminal_steps_ran'
        && (!Number.isFinite(Date.parse(run.updated_at)) || Date.parse(run.updated_at) > started - 10 * 60_000)) continue;
      const retry = disposition === 'retry_eligible';
      const runnerLost = run.conclusion === 'failure' && annotations.some(a => /\bself-hosted runner lost communication with the server\b/i.test(a.message));
      const exhausted = job.infrastructure_retry_count === 1 && disposition === 'terminal_no_steps' && runnerLost;
      const message = retry
        ? 'The build runner lost contact before any packaging step started. Retrying once automatically.'
        : exhausted ? 'The packaging run ended before any step started after one automatic retry. Deploy again to retry.'
          : disposition === 'terminal_steps_ran'
            ? 'The packaging run ended without reporting a result. It was not retried because it may have reached Intune. Check Intune before deploying again.'
            : runnerLost ? 'The build runner lost contact before any packaging step started. No automatic retry was made.'
              : `The packaging run ended (${run.conclusion}) before any step started. No automatic retry was made.`;
      const now = new Date().toISOString();
      const patch = retry ? {
        status: 'awaiting_qa', status_message: message, infrastructure_retry_count: 1,
        infrastructure_retry_run_id: job.github_run_id, github_run_id: null, github_run_url: null,
        packaging_started_at: null, progress_percent: 0, progress_message: null,
        error_message: null, error_code: null, error_category: null, error_stage: null,
        error_details: null, completed_at: null, qa_resume_due_at: new Date(Date.now() + 60_000).toISOString(), updated_at: now,
      } : { status: 'failed', status_message: message, error_message: message,
        error_code: runnerLost ? 'WORKFLOW_RUNNER_LOST' : 'WORKFLOW_ENDED_WITHOUT_RESULT',
        error_category: 'system', error_stage: 'unknown', completed_at: now, updated_at: now };
      let update = supabase.from('packaging_jobs').update(patch).eq('id', job.id)
        .eq('status', job.status).eq('updated_at', job.updated_at).eq('github_run_id', job.github_run_id)
        .is('intune_app_id', null).is('cancelled_at', null).is('archived_at', null);
      if (retry) update = update.eq('qa_candidate_id', job.qa_candidate_id)
        .eq('execution_profile_sha256', job.execution_profile_sha256).eq('infrastructure_retry_count', 0);
      const { data: changed, error: writeError } = await update.select('id');
      if (writeError || changed?.length !== 1) continue;
      result.reconciled++;
      if (!retry && job.is_auto_update) await handleAutoUpdateJobCompletion(job.id, 'failed', message);
    } catch (e) {
      if (e instanceof WorkflowReadRateLimitError) { result.deferred = true; break; }
      // Unavailable evidence never authorizes retry or a guessed terminal write.
    }
  }
  // Recover at most one uncaptured identity after the existing bound-run pass.
  // Binding alone never retries, completes or changes the customer job status.
  if (result.deferred || Date.now() >= deadline) return result;
  const missingQuery = (head = false) => supabase.from('packaging_jobs')
    .select('id,status,github_run_id,updated_at,packaging_started_at,infrastructure_retry_count,infrastructure_retry_run_id', { head, count: head ? 'exact' : undefined })
    .in('status', ['packaging', 'uploading']).is('github_run_id', null)
    .is('intune_app_id', null).is('cancelled_at', null).is('archived_at', null)
    .not('packaging_started_at', 'is', null).in('infrastructure_retry_count', [0, 1])
    .lt('updated_at', cutoff).order('packaging_started_at', { ascending: false }).order('id', { ascending: true })
    .abortSignal(AbortSignal.timeout(Math.max(1, deadline - Date.now())));
  const { count, error: countError } = await missingQuery(true);
  if (countError || !Number.isSafeInteger(count) || count == null || count <= 0 || Date.now() >= deadline) return result;
  // The cron runs every five minutes. Rotate over the whole eligible set so
  // an unmatched row cannot keep the only lookup slot on every pass. No job
  // timestamp is written on a miss, preserving the existing stale timeout.
  const offset = Math.floor(started / (5 * 60_000)) % count;
  const { data: missing, error: missingError } = await missingQuery().range(offset, offset);
  if (missingError || !missing?.length || Date.now() >= deadline) return result;
  const job = missing[0];
  if (!job.packaging_started_at || ![0, 1].includes(job.infrastructure_retry_count)) return result;
  try {
    const run = await findPackagingWorkflowRun(job.id, job.packaging_started_at, expected, Math.max(1, Math.min(8_000, deadline - Date.now())));
    if (!run || !Number.isSafeInteger(run.id) || run.id <= 0 || String(run.id) === job.infrastructure_retry_run_id || Date.now() >= deadline) return result;
    const { data: owners, error: ownerError } = await supabase.from('packaging_jobs').select('id').eq('github_run_id', String(run.id)).limit(1);
    if (ownerError || !owners || owners.length || Date.now() >= deadline) return result;
    let bind = supabase.from('packaging_jobs').update({ github_run_id: String(run.id),
      github_run_url: `https://github.com/${encodeURIComponent(expected.owner)}/${encodeURIComponent(expected.workflowsRepo)}/actions/runs/${run.id}` })
      .eq('id', job.id).eq('status', job.status).eq('updated_at', job.updated_at).is('github_run_id', null)
      .eq('packaging_started_at', job.packaging_started_at).eq('infrastructure_retry_count', job.infrastructure_retry_count)
      .is('intune_app_id', null).is('cancelled_at', null).is('archived_at', null);
    bind = job.infrastructure_retry_run_id == null ? bind.is('infrastructure_retry_run_id', null) : bind.eq('infrastructure_retry_run_id', job.infrastructure_retry_run_id);
    const { data: changed, error: bindError } = await bind.select('id');
    if (!bindError && changed?.length === 1) result.reconciled++;
  } catch (e) {
    if (e instanceof WorkflowReadRateLimitError) result.deferred = true;
  }
  return result;
}
