/**
 * Auto-Update Job Cleanup
 * Handles auto-update tracking when packaging jobs reach terminal states.
 * Ensures auto_update_history and app_update_policies stay consistent
 * regardless of how a job finishes (callback, timeout, or cancellation).
 */

import { createClient } from '@supabase/supabase-js';
import { DEFAULT_SAFETY_CONFIG } from '@/types/update-policies';
import type { AutoUpdateStatus } from '@/types/update-policies';
import { isIntuneApprovalFailure } from '@/lib/intune-approval';

type TerminalStatus = 'deployed' | 'duplicate_skipped' | 'failed' | 'cancelled';

const TERMINAL_HISTORY_STATUSES: AutoUpdateStatus[] = ['completed', 'failed', 'cancelled'];

interface PackageConfig {
  autoUpdateHistoryId?: string;
  [key: string]: unknown;
}

/**
 * Clean up auto-update tracking when a packaging job reaches a terminal state.
 * This function is idempotent -- if the auto_update_history record is already
 * in a terminal state, policy tracking updates are skipped to prevent
 * double-counting failures.
 *
 * On success (deployed/duplicate_skipped):
 *   - Marks auto_update_history as 'completed'
 *   - Resets consecutive_failures to 0
 *
 * On failure (failed/cancelled):
 *   - Marks auto_update_history as failed/cancelled
 *   - Sets last_auto_update_version to null (so the update reappears in Available tab)
 *   - Increments consecutive_failures (disables policy after threshold)
 */
export async function handleAutoUpdateJobCompletion(
  jobId: string,
  terminalStatus: TerminalStatus,
  errorMessage?: string
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[AutoUpdate Cleanup] Missing Supabase configuration');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch the job to check if it's an auto-update
  const { data: job, error: fetchError } = await supabase
    .from('packaging_jobs')
    .select('id, is_auto_update, auto_update_policy_id, package_config, error_category, error_code')
    .eq('id', jobId)
    .single();

  if (fetchError || !job) {
    console.error('[AutoUpdate Cleanup] Failed to fetch job:', fetchError?.message);
    return;
  }

  // Guard: not an auto-update job
  if (!job.is_auto_update || !job.auto_update_policy_id) {
    return;
  }

  const policyId = job.auto_update_policy_id;
  const packageConfig = job.package_config as PackageConfig | null;
  const historyId = packageConfig?.autoUpdateHistoryId;

  if (!historyId) {
    console.warn(
      `[AutoUpdate Cleanup] No historyId found in package_config for job ${jobId} -- cannot verify idempotency, skipping`
    );
    return;
  }

  const isSuccess = terminalStatus === 'deployed' || terminalStatus === 'duplicate_skipped';

  // Idempotency check: if the history record is already in a terminal state,
  // cleanup has already run. Skip policy updates to avoid double-counting.
  if (historyId) {
    const { data: historyRecord } = await supabase
      .from('auto_update_history')
      .select('status')
      .eq('id', historyId)
      .single();

    if (historyRecord && TERMINAL_HISTORY_STATUSES.includes(historyRecord.status)) {
      return;
    }
  }

  // Update auto_update_history record
  if (historyId) {
    if (isSuccess) {
      await supabase
        .from('auto_update_history')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', historyId);
    } else {
      const historyStatus = terminalStatus === 'cancelled' ? 'cancelled' : 'failed';
      await supabase
        .from('auto_update_history')
        .update({
          status: historyStatus,
          error_message: errorMessage || `Job ${terminalStatus}`,
          completed_at: new Date().toISOString(),
        })
        .eq('id', historyId);
    }
  }

  // Update the policy tracking
  if (isSuccess) {
    // Reset failure counter on success
    await supabase
      .from('app_update_policies')
      .update({
        consecutive_failures: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', policyId);
  } else {
    // On failure: clear last_auto_update_version so update reappears in Available tab
    // and increment consecutive_failures for circuit breaker
    const { data: policy } = await supabase
      .from('app_update_policies')
      .select('consecutive_failures')
      .eq('id', policyId)
      .single();

    const newFailureCount = (policy?.consecutive_failures ?? 0) + 1;
    const shouldDisable = newFailureCount >= DEFAULT_SAFETY_CONFIG.maxConsecutiveFailures;

    const updates: Record<string, unknown> = {
      last_auto_update_version: null,
      consecutive_failures: newFailureCount,
      updated_at: new Date().toISOString(),
    };

    if (shouldDisable) {
      updates.is_enabled = false;
      console.warn(
        `[AutoUpdate Cleanup] Circuit breaker: disabling policy ${policyId} after ${newFailureCount} consecutive failures`
      );
    }

    await supabase.from('app_update_policies').update(updates).eq('id', policyId);
  }

  // Auto-dismiss failed/cancelled auto-update jobs from the dashboard.
  // Successful deployments stay visible so users can see what was auto-deployed.
  if (!isSuccess) {
    try {
      // Dismissing an approval failure must not erase the retained-app checkpoint.
      if (isIntuneApprovalFailure(job)) {
        const { error } = await supabase.from('packaging_jobs')
          .update({ archived_at: new Date().toISOString() }).eq('id', jobId);
        if (error) console.error('[AutoUpdate Cleanup] Approval checkpoint archive failed');
        return;
      }
      // Clear FK reference in msp_batch_deployment_items before deleting
      const { error: fkClearError } = await supabase
        .from('msp_batch_deployment_items')
        .update({ packaging_job_id: null })
        .eq('packaging_job_id', jobId);

      if (fkClearError) {
        console.error('[AutoUpdate Cleanup] Failed to clear FK before delete:', fkClearError.message);
        return;
      }

      const { error: jobDeleteError } = await supabase
        .from('packaging_jobs')
        .delete()
        .eq('id', jobId);

      if (jobDeleteError) {
        console.error('[AutoUpdate Cleanup] Failed to delete job row:', jobDeleteError.message);
      }
    } catch (deleteError) {
      // Non-critical: tracking data is already persisted, dashboard will self-clean after 7 days
      console.error('[AutoUpdate Cleanup] Failed to auto-dismiss job from dashboard:', deleteError);
    }
  }
}
