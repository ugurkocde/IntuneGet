/**
 * MSP Batch Deployment Orchestrator
 * Processes pending batch deployments by creating packaging jobs and tracking completion.
 * Works in tandem with the cron endpoint (every 2 min) and the package callback route.
 */

import { createServerClient } from '@/lib/supabase';
import { getDatabase } from '@/lib/db';
import {
  isGitHubActionsConfigured,
  triggerPackagingWorkflow,
  type WorkflowInputs,
} from '@/lib/github-actions';
import { getAppConfig } from '@/lib/config';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import { queueWebhookDelivery } from '@/lib/msp/webhook-service';
import { createAuditLog } from '@/lib/audit-logger';

// Stale timeout: items in_progress longer than this are marked failed
const STALE_TIMEOUT_MINUTES = 45;

interface InstallerDetails {
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
          .select('id')
          .eq('batch_id', batch.id)
          .eq('status', 'in_progress')
          .lt('started_at', staleThreshold);

        if (staleError) {
          summary.errors.push(`Stale check for batch ${batch.id}: ${staleError.message}`);
          continue;
        }

        // Mark stale items as failed
        if (staleItems && staleItems.length > 0) {
          const staleIds = staleItems.map((item) => item.id);
          await supabase
            .from('msp_batch_deployment_items')
            .update({
              status: 'failed',
              error_message: 'Timed out waiting for packaging',
              completed_at: new Date().toISOString(),
            })
            .in('id', staleIds);

          summary.staleItemsRecovered += staleIds.length;
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
  const { data: pendingItems, error: pendingError } = await supabase
    .from('msp_batch_deployment_items')
    .select('*')
    .eq('batch_id', batchId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(availableSlots);

  if (pendingError || !pendingItems || pendingItems.length === 0) {
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
    batch.version
  );

  // Build callback URL
  const config = getAppConfig();
  const baseUrl =
    config.app.url ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const callbackUrl = `${baseUrl}/api/package/callback`;

  const db = getDatabase();
  let started = 0;

  for (const item of pendingItems) {
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

      // Create packaging job
      const jobId = crypto.randomUUID();
      const jobRecord = await db.jobs.create({
        id: jobId,
        user_id: batch.created_by_user_id,
        user_email: batch.created_by_email,
        tenant_id: item.tenant_id,
        winget_id: batch.winget_id,
        version: batch.version,
        display_name: batch.display_name,
        publisher: null,
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

      // Trigger GitHub Actions workflow
      const workflowInputs: WorkflowInputs = {
        jobId,
        tenantId: item.tenant_id,
        wingetId: batch.winget_id,
        displayName: batch.display_name,
        publisher: '',
        version: batch.version,
        installerUrl: installerDetails.installer_url,
        installerSha256: installerDetails.installer_sha256,
        installerType: installerDetails.installer_type,
        silentSwitches: installerDetails.silent_args,
        uninstallCommand: '',
        callbackUrl,
        installScope: (installerDetails.installer_scope as 'machine' | 'user') || undefined,
      };

      const triggerResult = await triggerPackagingWorkflow(workflowInputs);

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

      // Link job to batch item and mark in_progress
      await supabase
        .from('msp_batch_deployment_items')
        .update({
          packaging_job_id: jobId,
          status: 'in_progress',
          started_at: new Date().toISOString(),
        })
        .eq('id', item.id);

      started++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to trigger packaging workflow';
      await supabase
        .from('msp_batch_deployment_items')
        .update({
          status: 'failed',
          error_message: msg,
          completed_at: new Date().toISOString(),
        })
        .eq('id', item.id);
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
      failed_tenants: failed,
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
        failed_tenants: failed,
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
          failed_tenants: failed,
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
 * Look up installer details from the version_history table.
 * Falls back to parsing the installers JSONB if the top-level fields are null.
 */
async function lookupInstallerDetails(
  wingetId: string,
  version: string
): Promise<InstallerDetails | null> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('version_history')
    .select('installer_url, installer_sha256, installer_type, installer_scope, installers')
    .eq('winget_id', wingetId)
    .eq('version', version)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  // Try top-level fields first
  if (data.installer_url) {
    const type = data.installer_type || 'exe';
    return {
      installer_url: data.installer_url,
      installer_sha256: data.installer_sha256 || '',
      installer_type: type,
      silent_args: extractSilentSwitches('', type),
      installer_scope: data.installer_scope || 'machine',
    };
  }

  // Fall back to installers JSONB array
  if (data.installers && Array.isArray(data.installers) && data.installers.length > 0) {
    // Prefer x64 architecture
    const installers = data.installers as Array<Record<string, unknown>>;
    const preferred =
      installers.find((i) => i.architecture === 'x64') || installers[0];

    if (preferred && typeof preferred.url === 'string') {
      const type = (typeof preferred.type === 'string' ? preferred.type : 'exe').toLowerCase();
      return {
        installer_url: preferred.url,
        installer_sha256: typeof preferred.sha256 === 'string' ? preferred.sha256 : '',
        installer_type: type,
        silent_args: typeof preferred.silent_args === 'string'
          ? preferred.silent_args
          : extractSilentSwitches('', type),
        installer_scope: typeof preferred.scope === 'string' ? preferred.scope : 'machine',
      };
    }
  }

  return null;
}
