/**
 * Cancel Package API Route
 * Cancels pending or in-process packaging jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { cancelWorkflowRun, isGitHubActionsConfigured } from '@/lib/github-actions';

interface CancelRequestBody {
  jobId: string;
}

// Statuses that can be cancelled
const CANCELLABLE_STATUSES = ['queued', 'packaging', 'uploading'];

export async function POST(request: NextRequest) {
  try {
    // Get the authorization header (Microsoft access token from MSAL)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in with Microsoft.' },
        { status: 401 }
      );
    }

    // Decode the token to get user info
    const accessToken = authHeader.slice(7);
    let userId: string;
    let userEmail: string;

    try {
      const tokenPayload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      userId = tokenPayload.oid || tokenPayload.sub;
      userEmail = tokenPayload.preferred_username || tokenPayload.email || 'unknown';

      if (!userId) {
        return NextResponse.json(
          { error: 'Invalid token: missing user identifier' },
          { status: 401 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid token format' },
        { status: 401 }
      );
    }

    // Parse request body
    const body: CancelRequestBody = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId is required' },
        { status: 400 }
      );
    }

    // Create Supabase client
    const supabase = createServerClient();

    // Fetch the job to verify ownership and check status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: fetchError } = await (supabase as any)
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

    // Verify the user owns this job
    if (job.user_id !== userId) {
      return NextResponse.json(
        { error: 'You do not have permission to cancel this job' },
        { status: 403 }
      );
    }

    // Check if job is in a cancellable status
    if (!CANCELLABLE_STATUSES.includes(job.status)) {
      return NextResponse.json(
        { error: `Job cannot be cancelled. Current status: ${job.status}` },
        { status: 400 }
      );
    }

    // Attempt to cancel GitHub workflow if run ID exists
    let githubCancelResult = null;
    if (job.github_run_id && isGitHubActionsConfigured()) {
      githubCancelResult = await cancelWorkflowRun(job.github_run_id);
      console.log('GitHub cancel result:', githubCancelResult);
    }

    // Update job status to cancelled in database
    // We update regardless of GitHub result - the user wants this cancelled
    const updateData: Record<string, unknown> = {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: userEmail,
      updated_at: new Date().toISOString(),
    };

    // Add note about GitHub cancellation if it had issues
    if (githubCancelResult && !githubCancelResult.success) {
      updateData.error_message = `Job cancelled by user. GitHub workflow: ${githubCancelResult.message}`;
    } else {
      updateData.error_message = 'Job cancelled by user';
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
      .from('packaging_jobs')
      .update(updateData)
      .eq('id', jobId)
      .eq('status', job.status); // Optimistic lock - only update if status hasn't changed

    if (updateError) {
      console.error('Database update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update job status. The job may have already changed status.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Job cancelled successfully',
      jobId,
      githubCancelled: githubCancelResult?.success ?? null,
    });
  } catch (error) {
    console.error('Cancel API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
