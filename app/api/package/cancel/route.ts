/**
 * Cancel Package API Route
 * Cancels pending or in-process packaging jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getDatabase } from '@/lib/db';
import { cancelWorkflowRun, isGitHubActionsConfigured } from '@/lib/github-actions';
import { parseAccessToken } from '@/lib/auth-utils';
import { handleAutoUpdateJobCompletion } from '@/lib/auto-update/cleanup';
import type { Database } from '@/types/database';

interface CancelRequestBody {
  jobId: string;
  dismiss?: boolean;
}

type PackagingJobRow = Database['public']['Tables']['packaging_jobs']['Row'];
type PackagingJobUpdate = Database['public']['Tables']['packaging_jobs']['Update'];

// Statuses that can be cancelled (active jobs)
const CANCELLABLE_STATUSES = ['queued', 'packaging', 'uploading'];
// Statuses that can be force-dismissed by the user
const DISMISSABLE_STATUSES = ['queued', 'packaging', 'uploading', 'completed', 'failed'];

export async function POST(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = user.userId;
    const userEmail = user.userEmail;

    // Parse request body
    const body: CancelRequestBody = await request.json();
    const { jobId, dismiss } = body;

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId is required' },
        { status: 400 }
      );
    }

    // Create Supabase client
    const supabase = createServerClient();

    // Fetch the job to verify ownership and check status
    const { data: job, error: fetchError } = await supabase
      .from('packaging_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (fetchError || !job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    const typedJob = job as PackagingJobRow;

    // Verify the user owns this job
    if (typedJob.user_id !== userId) {
      return NextResponse.json(
        { error: 'You do not have permission to cancel this job' },
        { status: 403 }
      );
    }

    // If dismiss is set for a terminal job, soft-archive it. The row remains
    // available to upload history and update-policy audit references.
    const terminalStatuses = ['completed', 'failed', 'cancelled', 'duplicate_skipped', 'deployed'];
    if (dismiss && terminalStatuses.includes(typedJob.status)) {
      // Run auto-update cleanup before deleting (defense-in-depth for stuck jobs)
      if (typedJob.is_auto_update) {
        const dismissStatus = (typedJob.status === 'deployed' || typedJob.status === 'duplicate_skipped')
          ? typedJob.status as 'deployed' | 'duplicate_skipped'
          : 'cancelled';
        await handleAutoUpdateJobCompletion(jobId, dismissStatus).catch((err) => {
          console.error('[Cancel] Auto-update cleanup error on dismiss:', err);
        });
      }
      const db = getDatabase();
      await db.jobs.deleteById(jobId);
      return NextResponse.json({
        success: true,
        message: 'Job dismissed',
        jobId,
        archived: true,
      });
    }

    // Check if job is already cancelled or deployed (cannot be modified)
    if (typedJob.status === 'cancelled') {
      return NextResponse.json({
        success: true,
        message: 'Job is already cancelled',
        jobId,
        githubCancelled: null,
      });
    }

    if (typedJob.status === 'deployed') {
      return NextResponse.json(
        { error: 'Cannot cancel a deployed job. It is already in Intune.' },
        { status: 400 }
      );
    }

    // Check if job can be dismissed
    if (!DISMISSABLE_STATUSES.includes(typedJob.status)) {
      return NextResponse.json(
        { error: `Job cannot be cancelled. Current status: ${typedJob.status}` },
        { status: 400 }
      );
    }

    // Attempt to cancel GitHub workflow if run ID exists and job is still active
    let githubCancelResult = null;
    const isActiveJob = CANCELLABLE_STATUSES.includes(typedJob.status);
    if (isActiveJob && isGitHubActionsConfigured()) {
      if (!typedJob.github_run_id) {
        return NextResponse.json(
          {
            error: 'This workflow run could not be identified, so cancellation cannot be confirmed. Refresh and try again shortly.',
            retryable: true,
          },
          { status: 409 },
        );
      }

      githubCancelResult = await cancelWorkflowRun(typedJob.github_run_id);
      if (!githubCancelResult.success) {
        const status = githubCancelResult.status === 'error' ? 502 : 409;
        return NextResponse.json(
          {
            error: githubCancelResult.message,
            githubCancelled: false,
            retryable: githubCancelResult.status === 'error',
          },
          { status },
        );
      }
    }

    // Update the database only after GitHub accepted cancellation (or when the
    // job is handled by the local packager and no GitHub run exists).
    let errorMessage = 'Job cancelled by user';
    if (!isActiveJob) {
      errorMessage = `Job dismissed by user (was ${typedJob.status})`;
    }

    // Use token email, or fall back to job's stored user_email
    const cancelledByEmail = userEmail || typedJob.user_email || 'unknown';

    // Try full update first with all cancellation fields
    const fullUpdateData: PackagingJobUpdate = {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: cancelledByEmail,
      updated_at: new Date().toISOString(),
      error_message: errorMessage,
    };

    // Build query - use optimistic lock for active jobs, but allow force update for dismissed jobs
    let updateQuery = supabase
      .from('packaging_jobs')
      .update(fullUpdateData)
      .eq('id', jobId);

    // Only use optimistic lock for active jobs (prevent race conditions)
    // For dismissed jobs (completed/failed), we allow updating regardless of current status
    if (isActiveJob) {
      updateQuery = updateQuery.eq('status', typedJob.status);
    } else {
      // For non-active jobs, exclude already cancelled or deployed
      updateQuery = updateQuery.not('status', 'in', '("cancelled","deployed")');
    }

    let { error: updateError } = await updateQuery;

    // If full update fails (e.g., missing columns), try minimal update
    if (updateError) {
      // Fallback to minimal update with only essential fields
      const minimalUpdateData: PackagingJobUpdate = {
        status: 'cancelled',
        updated_at: new Date().toISOString(),
        error_message: errorMessage,
      };

      let minimalQuery = supabase
        .from('packaging_jobs')
        .update(minimalUpdateData)
        .eq('id', jobId);

      if (isActiveJob) {
        minimalQuery = minimalQuery.eq('status', typedJob.status);
      } else {
        minimalQuery = minimalQuery.not('status', 'in', '("cancelled","deployed")');
      }

      const { error: minimalError } = await minimalQuery;

      if (minimalError) {
        return NextResponse.json(
          { error: 'Failed to update job status. The job may have already changed status.' },
          { status: 500 }
        );
      }

      // Minimal update succeeded
      updateError = null;
    }

    // Clean up auto-update tracking
    handleAutoUpdateJobCompletion(jobId, 'cancelled', errorMessage).catch((err) => {
      console.error('[Cancel] Auto-update cleanup error:', err);
    });

    return NextResponse.json({
      success: true,
      message: 'Job cancelled successfully',
      jobId,
      githubCancelled: githubCancelResult?.success ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
