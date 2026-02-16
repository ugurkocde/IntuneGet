/**
 * Analytics Stats API Route
 * Returns dashboard statistics for the current user
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // Get the authorization header (Microsoft access token from MSAL)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Decode the token to get user info
    const accessToken = authHeader.slice(7);
    let userId: string;

    try {
      const tokenPayload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      userId = tokenPayload.oid || tokenPayload.sub;

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

    const supabase = createServerClient();

    // Define the shape of jobs returned from the queries
    interface PackagingJobStats {
      status: string;
      completed_at: string | null;
    }

    interface PackagingJobRecent {
      id: string;
      winget_id: string;
      display_name: string;
      status: string;
      created_at: string;
      intune_app_url: string | null;
    }

    // Get start of month in UTC for consistent timezone handling
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      1
    ));

    // Fetch all jobs in a single query and aggregate in memory
    // This is more efficient than 4 separate count queries
    const { data: jobs, error: jobsError } = await supabase
      .from('packaging_jobs')
      .select('status, completed_at')
      .eq('user_id', userId);

    // Fetch 5 most recent jobs for activity feed
    const { data: recentJobs, error: recentJobsError } = await supabase
      .from('packaging_jobs')
      .select('id, winget_id, display_name, status, created_at, intune_app_url')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (recentJobsError) {
      // Failed to fetch recent jobs - continue with empty array
    }

    if (jobsError) {
      return NextResponse.json(
        { error: 'Failed to fetch statistics' },
        { status: 500 }
      );
    }

    const allJobs = (jobs || []) as PackagingJobStats[];

    // Aggregate stats in memory
    let totalDeployed = 0;
    let thisMonth = 0;
    let pending = 0;
    let failed = 0;

    const pendingStatuses = ['queued', 'packaging', 'testing', 'uploading'];

    for (const job of allJobs) {
      // 'deployed' is the final success status (uploaded to Intune)
      // 'completed' is used for packaging-only completion (less common)
      if (job.status === 'deployed' || job.status === 'completed') {
        totalDeployed++;
        // Check if completed this month (using UTC)
        if (job.completed_at) {
          const completedDate = new Date(job.completed_at);
          if (completedDate >= startOfMonth) {
            thisMonth++;
          }
        }
      } else if (job.status === 'failed') {
        failed++;
      } else if (pendingStatuses.includes(job.status)) {
        pending++;
      }
    }

    // Transform recent jobs to activity items
    interface RecentActivityItem {
      id: string;
      type: 'upload' | 'package' | 'error';
      displayName: string;
      description: string;
      timestamp: string;
      status: 'success' | 'pending' | 'failed';
      intuneAppUrl?: string;
    }

    const allRecentJobs = (recentJobs || []) as PackagingJobRecent[];
    const recentActivity: RecentActivityItem[] = allRecentJobs.map((job) => {
      let type: 'upload' | 'package' | 'error' = 'package';
      let status: 'success' | 'pending' | 'failed' = 'pending';
      let description = '';

      switch (job.status) {
        case 'deployed':
          // Final success state - app is in Intune
          type = 'upload';
          status = 'success';
          description = `Deployed ${job.display_name || job.winget_id}`;
          break;
        case 'completed':
          // Packaging completed but not yet uploaded to Intune
          type = 'package';
          status = 'success';
          description = `Packaged ${job.display_name || job.winget_id}`;
          break;
        case 'failed':
          type = 'error';
          status = 'failed';
          description = `Failed to deploy ${job.display_name || job.winget_id}`;
          break;
        case 'cancelled':
          type = 'error';
          status = 'failed';
          description = `Cancelled ${job.display_name || job.winget_id}`;
          break;
        case 'queued':
          type = 'package';
          status = 'pending';
          description = `Queued ${job.display_name || job.winget_id}`;
          break;
        case 'packaging':
          type = 'package';
          status = 'pending';
          description = `Packaging ${job.display_name || job.winget_id}`;
          break;
        case 'uploading':
          type = 'upload';
          status = 'pending';
          description = `Uploading ${job.display_name || job.winget_id}`;
          break;
        default:
          // Unknown status - show as pending
          description = `Processing ${job.display_name || job.winget_id}`;
      }

      return {
        id: job.id,
        type,
        displayName: job.display_name || job.winget_id,
        description,
        timestamp: job.created_at,
        status,
        intuneAppUrl: job.intune_app_url ?? undefined,
      };
    });

    return NextResponse.json({
      totalDeployed,
      thisMonth,
      pending,
      failed,
      recentActivity,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    );
  }
}
