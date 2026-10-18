import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';

const RECOVERY_BATCH_SIZE = 10;
const RECOVERY_SCAN_SIZE = 100;
const LIVE_STATUSES = new Set([
  'awaiting_qa', 'blocked_upstream', 'queued', 'packaging', 'uploading', 'completed', 'deployed',
  'awaiting_approval', 'awaiting_intune_approval',
]);
const equalHash = (left: string | null, right: string | null) =>
  Boolean(left && right && /^[a-f0-9]{64}$/i.test(left) && left.toUpperCase() === right.toUpperCase());

/** Reopen only failures superseded by a later exact QA pass. The next normal
 * resume invocation applies the existing compatibility, licence and dispatch gates.
 * Candidate and result rows remain read only; dismissed jobs remain dismissed. */
export async function reopenSupersededQaFailures(supabase: SupabaseClient<Database>): Promise<number> {
  const { data: jobs, error } = await supabase.from('packaging_jobs')
    .select('*, qa_candidates!inner(status)').eq('qa_candidates.status', 'passed')
    .eq('status', 'qa_failed').eq('error_code', 'QA_FAILED_EXECUTION_PROFILE')
    .eq('is_auto_update', false).is('archived_at', null).is('cancelled_at', null)
    .is('intune_app_id', null).order('created_at', { ascending: false }).limit(RECOVERY_SCAN_SIZE);
  if (error) throw error;
  let reopened = 0;
  let examined = 0;
  const seen = new Set<string>();
  for (const job of jobs || []) {
    if (job.status !== 'qa_failed' || job.error_code !== 'QA_FAILED_EXECUTION_PROFILE'
      || job.archived_at || job.cancelled_at || job.intune_app_id || job.is_auto_update
      || !job.tenant_id || !job.qa_candidate_id || !job.execution_profile_sha256
      || !job.installer_sha256 || !job.architecture || !job.updated_at) continue;
    const key = JSON.stringify([job.tenant_id, job.winget_id, job.version]);
    if (seen.has(key)) continue;
    seen.add(key);
    const failureTimes = [job.qa_completed_at, job.completed_at].filter(Boolean).map(value => Date.parse(value!));
    // Legacy failure rows lack completion times. Their server maintained update
    // time still proves that the observed failure preceded the later pass.
    if (!failureTimes.length) failureTimes.push(Date.parse(job.updated_at));
    if (failureTimes.some(value => !Number.isFinite(value))) continue;
    const failureTime = Math.max(...failureTimes);
    if (examined++ >= RECOVERY_BATCH_SIZE) break;

    const { data: candidate, error: candidateError } = await supabase.from('qa_candidates')
      .select('id, status, winget_id, version, architecture, installer_sha256, package_profile_sha256, finished_at')
      .eq('id', job.qa_candidate_id).maybeSingle();
    if (candidateError || !candidate || candidate.status !== 'passed'
      || candidate.winget_id !== job.winget_id || candidate.version !== job.version
      || candidate.architecture !== job.architecture
      || !equalHash(candidate.installer_sha256, job.installer_sha256)
      || !equalHash(candidate.package_profile_sha256, job.execution_profile_sha256)
      || !candidate.finished_at || !(Date.parse(candidate.finished_at) > failureTime)) continue;

    const { data: result, error: resultError } = await supabase.from('qa_package_results')
      .select('outcome, winget_id, tested_version, architecture, installer_sha256')
      .eq('package_profile_sha256', candidate.package_profile_sha256!).maybeSingle();
    if (resultError || !result || result.outcome !== 'Passed'
      || result.winget_id !== job.winget_id || result.tested_version !== job.version
      || result.architecture !== job.architecture
      || !equalHash(result.installer_sha256, job.installer_sha256)) continue;

    const { data: otherJobs, error: duplicateError } = await supabase.from('packaging_jobs')
      .select('id, status, intune_app_id, created_at, archived_at, cancelled_at')
      .eq('tenant_id', job.tenant_id).eq('winget_id', job.winget_id).eq('version', job.version)
      .neq('id', job.id).limit(51);
    if (duplicateError || !otherJobs || otherJobs.length >= 51 || otherJobs.some(other =>
      other.intune_app_id || LIVE_STATUSES.has(other.status)
      || (!other.archived_at && !other.cancelled_at && other.status === 'qa_failed'
        && Date.parse(other.created_at) >= Date.parse(job.created_at)))) continue;
    const { data: history, error: historyError } = await supabase.from('upload_history')
      .select('id').eq('intune_tenant_id', job.tenant_id)
      .eq('winget_id', job.winget_id).eq('version', job.version).limit(1);
    if (historyError || !history || history.length) continue;

    const consent = await verifyTenantConsent(job.tenant_id);
    if (!consent.verified) continue;

    // Bind the write to the full observed execution identity and the dismissal
    // state. A concurrent edit, dismissal, cancellation or another invocation wins.
    let update = supabase.from('packaging_jobs').update({
      status: 'awaiting_qa', status_message: 'Installation test passed; deployment eligibility will be checked again',
      error_code: null, error_stage: null, error_category: null, error_message: null,
      completed_at: null, qa_completed_at: null,
    }).eq('id', job.id).eq('tenant_id', job.tenant_id).eq('winget_id', job.winget_id)
      .eq('version', job.version).eq('status', 'qa_failed').eq('error_code', 'QA_FAILED_EXECUTION_PROFILE')
      .eq('is_auto_update', false).is('archived_at', null).is('cancelled_at', null).is('intune_app_id', null)
      .eq('qa_candidate_id', job.qa_candidate_id).eq('execution_profile_sha256', job.execution_profile_sha256)
      .eq('installer_sha256', job.installer_sha256).eq('architecture', job.architecture);
    update = job.qa_completed_at == null ? update.is('qa_completed_at', null) : update.eq('qa_completed_at', job.qa_completed_at);
    update = job.completed_at == null ? update.is('completed_at', null) : update.eq('completed_at', job.completed_at);
    // The database update trigger advances this value for configuration and
    // presentation edits too. JSON objects are not scalar PostgREST eq values.
    update = update.eq('updated_at', job.updated_at);
    const { data: changed, error: updateError } = await update.select('id').maybeSingle();
    if (updateError) throw updateError;
    if (changed) reopened++;
  }
  return reopened;
}

