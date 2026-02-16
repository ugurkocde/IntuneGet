/**
 * Package Cleanup API Route
 * Marks stale jobs as failed (jobs stuck in intermediate states)
 * Can be called by a cron job or manually for maintenance
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// Jobs older than this (in minutes) in intermediate states will be marked as failed
const STALE_JOB_TIMEOUT_MINUTES = 30;

// Intermediate states that indicate a job might be stuck
const INTERMEDIATE_STATES = ['queued', 'packaging', 'testing', 'uploading'];

export async function POST(request: NextRequest) {
  try {
    // Verify cleanup secret for security
    const authHeader = request.headers.get('Authorization');
    const cleanupSecret = process.env.CLEANUP_SECRET || process.env.CALLBACK_SECRET;

    if (cleanupSecret && authHeader !== `Bearer ${cleanupSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // Calculate the cutoff time
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
        { error: 'Failed to fetch stale jobs' },
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
        { error: 'Failed to update stale jobs' },
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
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET handler for checking cleanup status / stats
 */
export async function GET() {
  try {
    const supabase = createServerClient();

    // Get count of jobs by status
    const { data: jobs, error } = await supabase
      .from('packaging_jobs')
      .select('status, updated_at')
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch job stats' },
        { status: 500 }
      );
    }

    // Count by status
    const statusCounts: Record<string, number> = {};
    const staleCount: Record<string, number> = {};
    const cutoffTime = new Date(
      Date.now() - STALE_JOB_TIMEOUT_MINUTES * 60 * 1000
    );

    for (const job of jobs || []) {
      statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;

      // Check if job is stale
      if (
        INTERMEDIATE_STATES.includes(job.status) &&
        new Date(job.updated_at) < cutoffTime
      ) {
        staleCount[job.status] = (staleCount[job.status] || 0) + 1;
      }
    }

    return NextResponse.json({
      status: 'ok',
      timeoutMinutes: STALE_JOB_TIMEOUT_MINUTES,
      statusCounts,
      staleJobs: staleCount,
      totalStale: Object.values(staleCount).reduce((a, b) => a + b, 0),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
