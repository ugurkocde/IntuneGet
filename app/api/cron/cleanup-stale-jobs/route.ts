/**
 * Cleanup Stale Jobs Cron Job
 * Runs every 5 minutes via Vercel Cron to mark stuck packaging jobs as failed.
 * Jobs in intermediate states (queued/packaging/uploading) for over 30 minutes
 * are considered stale and marked as failed with a timeout error.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const STALE_JOB_TIMEOUT_MINUTES = 30;
const INTERMEDIATE_STATES = ['queued', 'packaging', 'testing', 'uploading'];

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

    // Find stale jobs
    const { data: staleJobs, error: fetchError } = await supabase
      .from('packaging_jobs')
      .select('id, status, winget_id, updated_at, created_at')
      .in('status', INTERMEDIATE_STATES)
      .lt('updated_at', cutoffTime);

    if (fetchError) {
      return NextResponse.json(
        { error: 'Failed to fetch stale jobs', details: fetchError.message },
        { status: 500 }
      );
    }

    if (!staleJobs || staleJobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No stale jobs found',
        cleaned: 0,
      });
    }

    // Mark stale jobs as failed
    const jobIds = staleJobs.map((job) => job.id);

    const { error: updateError } = await supabase
      .from('packaging_jobs')
      .update({
        status: 'failed',
        error_message: `Job timed out after ${STALE_JOB_TIMEOUT_MINUTES} minutes without progress. This may indicate a callback delivery failure or workflow crash.`,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', jobIds);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update stale jobs', details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Marked ${staleJobs.length} stale job(s) as failed`,
      cleaned: staleJobs.length,
      jobs: staleJobs.map((job) => ({
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
