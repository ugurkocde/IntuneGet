import { isQaMaintenanceMode } from '@/lib/qa/maintenance';
/**
 * MSP Batch Deployment Orchestrator
 * Processes pending batch deployments by creating packaging jobs and tracking completion.
 * Works in tandem with the cron endpoint (every 2 min) and the package callback route.
 */

import { createServerClient } from '@/lib/supabase';
import { getCatalogSource } from '@/lib/catalog';
import { getDatabase } from '@/lib/db';
import { findPendingApprovalBlocks } from '@/lib/intune-approval-guard';
import {
  isGitHubActionsConfigured,
  triggerPackagingWorkflow,
} from '@/lib/github-actions';
import { assertCuratedLicenceAccepted, CuratedLicenceError } from '@/lib/curated-catalog/licence';
import { getAppConfig } from '@/lib/config';
import { buildStoredJobWorkflowInputs } from '@/lib/auto-update/stored-job-workflow-inputs';
import { DISPATCH_IDENTITY_KEY, dispatchRateLimitHold, WorkflowDispatchRateLimitError, WorkflowDispatchUnconfirmedError } from '@/lib/workflow-dispatch-rate-limit';
import type { Win32CartItem } from '@/types/upload';
import type { Json } from '@/types/database';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import { queueWebhookDelivery } from '@/lib/msp/webhook-service';
import { createAuditLog } from '@/lib/audit-logger';
import {
  describeQaGateError,
  enforceQaGate,
  isQaGateError,
  type AnyQaGateError,
} from '@/lib/qa/gate';
import { normalizeInstaller } from '@/lib/manifest-api';
import { selectTrustedCatalogInstaller } from '@/lib/catalog-installer-reconciliation';
import type { WingetInstaller } from '@/types/winget';

// Stale timeout: items in_progress longer than this are marked failed
const STALE_TIMEOUT_MINUTES = 45;

/** Pending tenants in one batch have no individual creation timestamp. */
export function loadPendingBatchItems(supabase: ReturnType<typeof createServerClient>, batchId: string, availableSlots: number) {
  return supabase.from('msp_batch_deployment_items').select('*')
    .eq('batch_id', batchId).eq('status', 'pending')
    .order('tenant_display_name', { ascending: true })
    .order('id', { ascending: true }).limit(availableSlots);
}

interface InstallerDetails {
  architecture: string;
  installer_url: string;
  installer_sha256: string;
  installer_type: string;
  silent_args: string;
  installer_scope: string;
}

interface BatchSummary {
  batchesProcessed: number;
  itemsStarted: number;
  errors: string[];
}

interface RecoverySummary {
  staleItemsRecovered: number;
  batchesCompleted: number;
  errors: string[];
}

// ============================================
// Main Entry Points
// ============================================

/**
 * Process all pending batches. Called by the cron endpoint.
 * Transitions each pending batch to in_progress and starts items up to concurrency limit.
 */
export async function processPendingBatches(): Promise<BatchSummary> {
  const supabase = createServerClient();
  const summary: BatchSummary = { batchesProcessed: 0, itemsStarted: 0, errors: [] };

  try {
    // Get all pending batches
    const { data: batches, error } = await supabase
      .from('msp_batch_deployments')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      summary.errors.push(`Failed to query pending batches: ${error.message}`);
      return summary;
    }

    if (!batches || batches.length === 0) {
      return summary;
    }

    for (const batch of batches) {
      try {
        // Transition batch to in_progress
        await supabase
          .from('msp_batch_deployments')
          .update({
            status: 'in_progress',
            started_at: new Date().toISOString(),
          })
          .eq('id', batch.id)
          .eq('status', 'pending'); // Optimistic lock

        const started = await startBatchItems(batch.id);
        summary.itemsStarted += started;
        summary.batchesProcessed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        summary.errors.push(`Batch ${batch.id}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    summary.errors.push(`processPendingBatches: ${msg}`);
  }

  return summary;
}

/**
 * Advance in-progress batches: recover stale items and check for completion.
 * Called by the cron endpoint.
 */
export async function advanceInProgressBatches(): Promise<RecoverySummary> {
  const supabase = createServerClient();
  const summary: RecoverySummary = { staleItemsRecovered: 0, batchesCompleted: 0, errors: [] };

  try {
    // Get all in_progress batches
    const { data: batches, error } = await supabase
      .from('msp_batch_deployments')
      .select('id')
      .eq('status', 'in_progress');

    if (error) {
      summary.errors.push(`Failed to query in_progress batches: ${error.message}`);
      return summary;
    }

    if (!batches || batches.length === 0) {
      return summary;
    }

    const staleThreshold = new Date(Date.now() - STALE_TIMEOUT_MINUTES * 60 * 1000).toISOString();

    for (const batch of batches) {
      try {
        // Find stale items (in_progress for too long)
        const { data: staleItems, error: staleError } = await supabase
          .from('msp_batch_deployment_items')
          .select('id, packaging_job_id')
          .eq('batch_id', batch.id)
          .eq('status', 'in_progress')
          .lt('started_at', staleThreshold);

        if (staleError) {
          summary.errors.push(`Stale check for batch ${batch.id}: ${staleError.message}`);
          continue;
        }

        // Mark stale items as failed
        if (staleItems && staleItems.length > 0) {
          const linkedIds = staleItems.flatMap(item => item.packaging_job_id ? [item.packaging_job_id] : []);
          const linked = linkedIds.length ? await supabase.from('packaging_jobs')
            .select('id, status, packaging_started_at').in('id', linkedIds) : { data: [], error: null };
          if (linked.error) {
            summary.errors.push(`Could not verify held batch jobs for ${batch.id}`);
            continue;
          }
          const staleIds = staleItems.filter(item => {
            const job = linked.data?.find(job => job.id === item.packaging_job_id);
            // Resume owns held jobs and stale-job cleanup owns the local queue.
            // Measure running jobs from their actual packaging start.
            return !['queued', 'awaiting_qa', 'blocked_upstream'].includes(job?.status ?? '') && !(['packaging', 'uploading'].includes(job?.status ?? '')
              && job?.packaging_started_at && job.packaging_started_at >= staleThreshold);
          }).map(item => item.id);
          if (staleIds.length) {
            await supabase
              .from('msp_batch_deployment_items')
              .update({
                status: 'failed',
                error_message: 'Timed out waiting for packaging',
                completed_at: new Date().toISOString(),
              })
              .in('id', staleIds).eq('status', 'in_progress');

            summary.staleItemsRecovered += staleIds.length;
          }
        }

        // Try to start more items and check completion
        await startBatchItems(batch.id);
        const completed = await advanceBatch(batch.id);
        if (completed) {
          summary.batchesCompleted++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        summary.errors.push(`Recovery for batch ${batch.id}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    summary.errors.push(`advanceInProgressBatches: ${msg}`);
  }

  return summary;
}

// ============================================
// Core Logic
// ============================================

/**
 * Start pending items for a batch up to its concurrency limit.
 * Returns the number of items started.
 */
async function startBatchItems(batchId: string): Promise<number> {
  const supabase = createServerClient();

  // Get batch details
  const { data: batch, error: batchError } = await supabase
    .from('msp_batch_deployments')
    .select('*')
    .eq('id', batchId)
    .single();

  if (batchError || !batch) {
    console.error(`[BatchOrchestrator] Failed to load batch ${batchId}:`, batchError?.message);
    return 0;
  }

  // Count currently in_progress items
  const { count: inProgressCount, error: countError } = await supabase
    .from('msp_batch_deployment_items')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('status', 'in_progress');

  if (countError) {
    console.error(`[BatchOrchestrator] Failed to count in_progress items:`, countError.message);
    return 0;
  }

  const currentInProgress = inProgressCount || 0;
  const availableSlots = batch.concurrency_limit - currentInProgress;

  if (availableSlots <= 0) {
    return 0;
  }

  // Get pending items
  const { data: pendingItems, error: pendingError } = await loadPendingBatchItems(supabase, batchId, availableSlots);

  if (pendingError) {
    // Database messages can include customer data. Log the code, never row values.
    const code = /^[A-Z0-9_]{2,20}$/.test(pendingError.code || '') ? pendingError.code : 'unknown';
    console.error(`[BatchOrchestrator] Failed to load pending items (${code})`);
    return 0;
  }
  if (!pendingItems || pendingItems.length === 0) {
    return 0;
  }

  // Check pipeline configuration
  if (!isGitHubActionsConfigured()) {
    // Mark all pending items as failed since we can't process them
    const itemIds = pendingItems.map((item) => item.id);
    await supabase
      .from('msp_batch_deployment_items')
      .update({
        status: 'failed',
        error_message: 'GitHub Actions packaging pipeline not configured',
        completed_at: new Date().toISOString(),
      })
      .in('id', itemIds);
    return 0;
  }

  // Get installer details from version_history
  const installerDetails = await lookupInstallerDetails(
    batch.winget_id,
    batch.version,
    batch.architecture || 'x64',
  );

  // Get the curated app description (falls back to the generic marker text)
  const appDescription = await lookupAppDescription(batch.winget_id);

  // Build callback URL
  const config = getAppConfig();
  const baseUrl =
    config.app.url ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const callbackUrl = `${baseUrl}/api/package/callback`;

  const db = getDatabase();
  let started = 0;

  // Evaluate the package tuple once before processing tenants. This avoids
  // creating one misleading job per tenant for a known current QA failure.
  let qaGateError: AnyQaGateError | null = null;
  if (installerDetails) {
    try {
      await enforceQaGate({
        qaOverride: isQaMaintenanceMode(),
        wingetId: batch.winget_id,
        version: batch.version,
        architecture: installerDetails.architecture,
        installerSha256: installerDetails.installer_sha256,
      });
    } catch (error) {
      if (isQaGateError(error)) qaGateError = error;
      else throw error;
    }
  }

  for (const item of pendingItems) {
    let jobId: string | null = null;
    let linked = false;
    let dispatched = false;
    try {
      // If no installer details, fail the item
      if (!installerDetails) {
        await supabase
          .from('msp_batch_deployment_items')
          .update({
            status: 'failed',
            error_message: 'Package version not found in catalog',
            completed_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        continue;
      }

      if (qaGateError) {
        await supabase
          .from('msp_batch_deployment_items')
          .update({
            status: 'skipped',
            error_message: describeQaGateError(qaGateError),
            completed_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        continue;
      }

      // Verify tenant consent
      const consentResult = await verifyTenantConsent(item.tenant_id);
      if (!consentResult.verified) {
        await supabase
          .from('msp_batch_deployment_items')
          .update({
            status: 'failed',
            error_message: 'Tenant consent not granted or revoked',
            completed_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        continue;
      }

      // A curated publisher licence is accepted per customer tenant, so an
      // acceptance for one tenant never authorizes the rest of the batch.
      try {
        await assertCuratedLicenceAccepted(item.tenant_id, batch.winget_id, db);
      } catch (error) {
        if (!(error instanceof CuratedLicenceError)) throw error;
        await supabase
          .from('msp_batch_deployment_items')
          .update({
            status: 'skipped',
            error_message: error.message,
            completed_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        continue;
      }

      const approvalBlocks = await findPendingApprovalBlocks({ tenantId: item.tenant_id,
        wingetIds: [batch.winget_id] }, { db });
      if (approvalBlocks.length) {
        await supabase.from('msp_batch_deployment_items').update({ status: 'skipped',
          error_message: approvalBlocks[0].message, completed_at: new Date().toISOString() })
          .eq('id', item.id);
        continue;
      }

      // Create packaging job
      jobId = crypto.randomUUID();
      const packageConfig = {
        id: jobId, wingetId: batch.winget_id, displayName: batch.display_name,
        publisher: '', version: batch.version, architecture: installerDetails.architecture,
        installerUrl: installerDetails.installer_url, installerSha256: installerDetails.installer_sha256,
        installerType: installerDetails.installer_type, installCommand: installerDetails.silent_args,
        uninstallCommand: '', installScope: installerDetails.installer_scope,
        description: appDescription ?? undefined,
      } as Win32CartItem;
      const jobRecord = await db.jobs.create({
        id: jobId,
        user_id: batch.created_by_user_id,
        user_email: batch.created_by_email,
        tenant_id: item.tenant_id,
        winget_id: batch.winget_id,
        version: batch.version,
        display_name: batch.display_name,
        publisher: null,
        architecture: installerDetails.architecture,
        install_command: installerDetails.silent_args,
        uninstall_command: '',
        package_config: packageConfig as unknown as Json,
        installer_type: installerDetails.installer_type,
        installer_url: installerDetails.installer_url,
        installer_sha256: installerDetails.installer_sha256,
        install_scope: installerDetails.installer_scope,
        status: 'queued',
        progress_percent: 0,
      });

      if (!jobRecord) {
        await supabase
          .from('msp_batch_deployment_items')
          .update({
            status: 'failed',
            error_message: 'Failed to create packaging job record',
            completed_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        continue;
      }

      // Claim the batch slot before any worker can report a dispatch result.
      const { data: claimed, error: linkError } = await supabase.from('msp_batch_deployment_items')
        .update({ packaging_job_id: jobId, status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', item.id).eq('status', 'pending').select('id').maybeSingle();
      if (linkError || !claimed) {
        await supabase.from('packaging_jobs').update({
          status: 'failed', error_code: 'BATCH_ITEM_LINK_FAILED',
          error_message: 'Could not claim the batch item before dispatch', completed_at: new Date().toISOString(),
        }).eq('id', jobId).eq('status', 'queued').is('github_run_id', null).is('callback_run_id', null)
          .is('cancelled_at', null).is('archived_at', null);
        continue;
      }
      linked = true;

      // Trigger GitHub Actions workflow
      const workflowInputs = buildStoredJobWorkflowInputs(
        jobRecord as Parameters<typeof buildStoredJobWorkflowInputs>[0], packageConfig,
        { callbackUrl, qaOverride: isQaMaintenanceMode(), sanitizeAssignments: false },
      );
      const triggerResult = await triggerPackagingWorkflow(workflowInputs, undefined, { newJobAdmission: true });

      dispatched = true;

      // Update job with run info
      const jobUpdate: Record<string, unknown> = {
        status: 'packaging',
        packaging_started_at: new Date().toISOString(),
      };
      if (triggerResult.runId) {
        jobUpdate.github_run_id = triggerResult.runId.toString();
        jobUpdate.github_run_url = triggerResult.runUrl;
      }
      await db.jobs.update(jobId, jobUpdate);

      started++;
    } catch (err) {
      // A confirmed dispatch is owned by its callbacks even if saving run
      // metadata failed. Keep the item linked for callback and sweep recovery.
      if (dispatched) {
        console.error('[BatchOrchestrator] Could not persist dispatched job metadata');
        started++;
        continue;
      }
      let failedByThisAttempt = false;
      if (jobId && (err instanceof WorkflowDispatchUnconfirmedError || err instanceof WorkflowDispatchRateLimitError)) {
        const hold = err instanceof WorkflowDispatchRateLimitError
          ? err.dispatchIdentity === undefined ? null : dispatchRateLimitHold(err, { [DISPATCH_IDENTITY_KEY]: err.dispatchIdentity })
          : dispatchRateLimitHold(err, null);
        const { data: won, error: writeError } = await supabase.from('packaging_jobs')
          .update(hold ?? { status: 'failed', error_code: err.code, error_stage: 'authenticate',
            error_category: 'network', error_message: err.message, completed_at: new Date().toISOString() })
          .eq('id', jobId).eq('status', 'queued').is('github_run_id', null).is('callback_run_id', null)
          .is('cancelled_at', null).is('archived_at', null).is('error_details', null).select('id').maybeSingle();
        failedByThisAttempt = !hold && !!won && !writeError;
        if (hold && won && !writeError) {
          started++;
          continue;
        }
      }
      const isQaSkip = isQaGateError(err);
      let msg = isQaSkip
        ? describeQaGateError(err)
        : err instanceof Error ? err.message : 'Failed to trigger packaging workflow';
      if (isQaSkip && jobId) {
        await db.jobs.update(jobId, {
          status: 'cancelled',
          status_message: 'Skipped because the installation test failed',
          error_message: msg,
          cancelled_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
      }
      if (!isQaSkip && jobId && !failedByThisAttempt) {
        const { data: failed, error: failError } = await supabase.from('packaging_jobs').update({
          status: 'failed', error_code: 'WORKFLOW_DISPATCH_FAILED',
          error_stage: 'authenticate', error_category: 'network', error_message: msg,
          completed_at: new Date().toISOString(),
        }).eq('id', jobId).eq('status', 'queued')
          .is('github_run_id', null).is('callback_run_id', null)
          .is('cancelled_at', null).is('archived_at', null).select('id').maybeSingle();
        if (failError) continue;
        if (!failed) {
          try {
            const current = await db.jobs.getById(jobId);
            if (current && ['completed', 'failed', 'duplicate_skipped'].includes(current.status)) continue;
            if (current && (current.callback_run_id || current.github_run_id
              || (!current.cancelled_at && current.status !== 'cancelled'))) {
              // Another worker, callback or cleanup owns this job state.
              started++;
              continue;
            }
            if (current?.cancelled_at || current?.status === 'cancelled') msg = 'Packaging was cancelled';
          } catch {
            // An unavailable read cannot disprove a concurrent worker's claim.
            continue;
          }
        }
      }
      const itemFailure = supabase
        .from('msp_batch_deployment_items')
        .update({
          status: isQaSkip ? 'skipped' : 'failed',
          error_message: msg,
          completed_at: new Date().toISOString(),
        })
        .eq('id', item.id);
      await (linked && jobId ? itemFailure.eq('packaging_job_id', jobId).eq('status', 'in_progress') : itemFailure);
    }
  }

  return started;
}

/**
 * Called from the callback route when a packaging job completes.
 * Looks up the batch item, updates its status, and advances the batch.
 */
export async function onJobCompleted(
  jobId: string,
  status: 'completed' | 'failed',
  errorMessage?: string
): Promise<void> {
  const supabase = createServerClient();

  try {
    // Find batch item linked to this job
    const { data: item, error: itemError } = await supabase
      .from('msp_batch_deployment_items')
      .select('id, batch_id')
      .eq('packaging_job_id', jobId)
      .single();

    if (itemError || !item) {
      // Job is not part of a batch - nothing to do
      return;
    }

    // Update the batch item
    await supabase
      .from('msp_batch_deployment_items')
      .update({
        status,
        error_message: status === 'failed' ? (errorMessage || 'Packaging failed') : null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', item.id);

    // Start next pending items and check batch completion
    await startBatchItems(item.batch_id);
    await advanceBatch(item.batch_id);
  } catch (err) {
    console.error(`[BatchOrchestrator] onJobCompleted error for job ${jobId}:`, err);
  }
}

/**
 * Update batch counters and check if the batch is complete.
 * Returns true if the batch transitioned to a terminal state.
 */
async function advanceBatch(batchId: string): Promise<boolean> {
  const supabase = createServerClient();

  // Get all items for this batch
  const { data: items, error: itemsError } = await supabase
    .from('msp_batch_deployment_items')
    .select('status')
    .eq('batch_id', batchId);

  if (itemsError || !items) {
    return false;
  }

  const completed = items.filter((i) => i.status === 'completed').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const skipped = items.filter((i) => i.status === 'skipped').length;
  const pending = items.filter((i) => i.status === 'pending').length;
  const inProgress = items.filter((i) => i.status === 'in_progress').length;

  // Update counters
  await supabase
    .from('msp_batch_deployments')
    .update({
      completed_tenants: completed,
      failed_tenants: failed + skipped,
    })
    .eq('id', batchId);

  // Check if all items are in a terminal state
  const allDone = pending === 0 && inProgress === 0;
  if (!allDone) {
    return false;
  }

  // Determine final batch status
  const allFailed = failed + skipped === items.length;
  const finalStatus = allFailed ? 'failed' : 'completed';

  // Get batch details for webhook/audit
  const { data: batch } = await supabase
    .from('msp_batch_deployments')
    .select('*')
    .eq('id', batchId)
    .single();

  // Update batch to terminal state
  await supabase
    .from('msp_batch_deployments')
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
    })
    .eq('id', batchId)
    .eq('status', 'in_progress'); // Only if still in_progress (avoid overwriting cancelled)

  // Fire webhook and audit log
  if (batch) {
    const eventType = finalStatus === 'completed' ? 'batch.completed' : 'batch.completed';
    try {
      await queueWebhookDelivery(batch.organization_id, eventType, {
        batch_id: batchId,
        winget_id: batch.winget_id,
        display_name: batch.display_name,
        version: batch.version,
        status: finalStatus,
        total_tenants: items.length,
        completed_tenants: completed,
        failed_tenants: failed + skipped,
        skipped_tenants: skipped,
      });
    } catch (err) {
      console.error(`[BatchOrchestrator] Webhook delivery error for batch ${batchId}:`, err);
    }

    // Audit log
    const auditAction = finalStatus === 'completed'
      ? 'batch.deployment_completed' as const
      : 'batch.deployment_failed' as const;

    try {
      await createAuditLog({
        organization_id: batch.organization_id,
        user_id: batch.created_by_user_id,
        user_email: batch.created_by_email || '',
        action: auditAction,
        resource_type: 'batch_deployment',
        resource_id: batchId,
        details: {
          winget_id: batch.winget_id,
          version: batch.version,
          status: finalStatus,
          total_tenants: items.length,
          completed_tenants: completed,
          failed_tenants: failed + skipped,
          skipped_tenants: skipped,
        },
      });
    } catch (err) {
      console.error(`[BatchOrchestrator] Audit log error for batch ${batchId}:`, err);
    }
  }

  return true;
}

// ============================================
// Helpers
// ============================================

/**
 * Look up the curated app description for a package.
 * Returns undefined when the app is not in the catalog or has no description.
 */
async function lookupAppDescription(wingetId: string): Promise<string | undefined> {
  return getCatalogSource().getAppDescription(wingetId);
}

/**
 * Look up installer details from the version_history table.
 * Falls back to parsing the installers JSONB if the top-level fields are null.
 */
export async function lookupInstallerDetails(
  wingetId: string,
  version: string,
  architecture: string,
): Promise<InstallerDetails | null> {
  const data = await getCatalogSource().getLatestVersionInstallerInfo(wingetId, version);

  if (!data) {
    return null;
  }

  if (data.installers && Array.isArray(data.installers) && data.installers.length > 0) {
    const installers = (data.installers as Array<Record<string, unknown>>)
      .map((value) => normalizeInstaller(value as unknown as WingetInstaller));
    const preferred = selectTrustedCatalogInstaller(installers, {
      wingetId,
      version,
      architecture,
      installScope: 'machine',
    });
    if (preferred?.url) {
      const type = preferred.type || 'exe';
      return {
        architecture: preferred.architecture || architecture,
        installer_url: preferred.url,
        installer_sha256: preferred.sha256 || '',
        installer_type: type,
        silent_args: preferred.silentArgs || extractSilentSwitches('', type),
        installer_scope: preferred.scope || 'machine',
      };
    }
  }

  return null;
}
