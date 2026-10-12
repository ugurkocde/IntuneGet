/**
 * Cleanup Stale Jobs Cron Job
 * Runs every 5 minutes via Vercel Cron to mark stuck packaging jobs as failed.
 * Jobs in intermediate states (queued/packaging/uploading) without progress for
 * longer than STALE_JOB_TIMEOUT_MINUTES are marked as failed with a timeout
 * error.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleAutoUpdateJobCompletion } from '@/lib/auto-update/cleanup';
import {
  STALE_JOB_TIMEOUT_MINUTES,
  INTERMEDIATE_STATES,
  STALE_JOB_ERROR_MESSAGE,
  keepActuallyStaleJobs,
} from '@/lib/stale-jobs';

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Missing Supabase configuration' },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const cutoffTime = new Date(
      Date.now() - STALE_JOB_TIMEOUT_MINUTES * 60 * 1000
    ).toISOString();

    // Find stale jobs (include auto-update fields for cleanup)
    const { data: staleJobs, error: fetchError } = await supabase
      .from('packaging_jobs')
      .select('id, status, winget_id, tenant_id, updated_at, created_at, github_run_id, is_auto_update, auto_update_policy_id')
      .in('status', INTERMEDIATE_STATES)
      .lt('updated_at', cutoffTime);

    if (fetchError) {
      return NextResponse.json(
        { error: 'Failed to fetch stale jobs', details: fetchError.message },
        { status: 500 }
      );
    }

    // A queued run only waits legitimately while its tenant has an executing
    // job, because the workflow runs one job per tenant at a time. A running
    // workflow reports progress well inside the timeout, so only jobs updated
    // since the cutoff count. That also keeps a stuck job, which may already be
    // marked packaging, from counting as the job it waits behind. Only the
    // candidate tenants are queried so the result stays far below row limits.
    const candidateTenantIds = [...new Set(
      (staleJobs || [])
        .filter((job) => job.tenant_id)
        .map((job) => job.tenant_id as string)
    )];
    const { data: executingJobs, error: executingError } = candidateTenantIds.length === 0
      ? { data: [], error: null }
      : await supabase
        .from('packaging_jobs')
        .select('tenant_id')
        .in('status', ['packaging', 'uploading'])
        .in('tenant_id', candidateTenantIds)
        .gte('updated_at', cutoffTime);

    if (executingError) {
      return NextResponse.json(
        { error: 'Failed to fetch executing jobs', details: executingError.message },
        { status: 500 }
      );
    }

    const tenantsWithExecutingJobs = new Set(
      (executingJobs || [])
        .map((job) => job.tenant_id)
        .filter((tenantId): tenantId is string => typeof tenantId === 'string' && tenantId.length > 0)
    );

    const confirmedStaleJobs = await keepActuallyStaleJobs(staleJobs || [], { tenantsWithExecutingJobs });

    if (confirmedStaleJobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No stale jobs found',
        cleaned: 0,
      });
    }

    // Mark stale jobs as failed. The status and updated_at filters skip any
    // job whose run started and reported progress after it was checked.
    const jobIds = confirmedStaleJobs.map((job) => job.id);

    const { data: failedRows, error: updateError } = await supabase
      .from('packaging_jobs')
      .update({
        status: 'failed',
        error_message: STALE_JOB_ERROR_MESSAGE,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', jobIds)
      .in('status', INTERMEDIATE_STATES)
      .lt('updated_at', cutoffTime)
      .select('id');

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update stale jobs', details: updateError.message },
        { status: 500 }
      );
    }

    const failedIds = new Set((failedRows || []).map((row) => row.id));
    const failedJobs = confirmedStaleJobs.filter((job) => failedIds.has(job.id));

    // Clean up auto-update tracking for stale auto-update jobs
    const autoUpdateJobs = failedJobs.filter((job) => job.is_auto_update);
    if (autoUpdateJobs.length > 0) {
      const timeoutMessage = `Job timed out after ${STALE_JOB_TIMEOUT_MINUTES} minutes without progress`;
      const cleanupResults = await Promise.allSettled(
        autoUpdateJobs.map((job) =>
          handleAutoUpdateJobCompletion(job.id, 'failed', timeoutMessage)
        )
      );

      for (let i = 0; i < cleanupResults.length; i++) {
        const result = cleanupResults[i];
        if (result.status === 'rejected') {
          console.error(
            `[CronCleanup] Auto-update cleanup failed for job ${autoUpdateJobs[i].id}:`,
            result.reason
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Marked ${failedJobs.length} stale job(s) as failed`,
      cleaned: failedJobs.length,
      jobs: failedJobs.map((job) => ({
        id: job.id,
        previousStatus: job.status,
        wingetId: job.winget_id,
      })),
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export const maxDuration = 60;
