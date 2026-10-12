/**
 * Analytics API Route
 * Returns full analytics data with trends and charts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { parseAccessToken } from '@/lib/auth-utils';

interface DailyDeployment {
  date: string;
  completed: number;
  failed: number;
}

interface TopApp {
  wingetId: string;
  displayName: string;
  publisher: string;
  count: number;
}

interface RecentFailure {
  id: string;
  wingetId: string;
  displayName: string;
  errorMessage: string;
  createdAt: string;
}

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get date range from query params (default: last 30 days)
    // Clamp to reasonable range: 1-365 days
    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get('days');
    const days = Math.min(Math.max(parseInt(daysParam || '30', 10) || 30, 1), 365);

    // Use UTC for consistent timezone handling with database timestamps
    const now = new Date();
    const startDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - days
    ));

    const database = getDatabase();

    // Define the shape of jobs returned from the query
    interface PackagingJobAnalytics {
      id: string;
      winget_id: string;
      display_name: string;
      publisher: string | null;
      status: string;
      error_message: string | null;
      created_at: string;
      completed_at: string | null;
    }

    // Get all jobs in date range
    const jobs = (await database.jobs.getByUserId(user.userId)).filter(
      (job) => new Date(job.created_at) >= startDate
    );

    const allJobs = (jobs || []) as PackagingJobAnalytics[];

    // Calculate success rate
    const completedJobs = allJobs.filter((j) => j.status === 'completed').length;
    const failedJobs = allJobs.filter((j) => j.status === 'failed').length;
    const totalFinished = completedJobs + failedJobs;
    const successRate = totalFinished > 0 ? Math.round((completedJobs / totalFinished) * 100) : 0;

    // Build daily deployment data
    const dailyMap = new Map<string, { completed: number; failed: number }>();

    // Initialize all days in range
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      dailyMap.set(dateStr, { completed: 0, failed: 0 });
    }

    // Fill in actual data
    allJobs.forEach((job) => {
      const date = job.completed_at
        ? new Date(job.completed_at).toISOString().split('T')[0]
        : new Date(job.created_at).toISOString().split('T')[0];

      const existing = dailyMap.get(date);
      if (existing) {
        if (job.status === 'completed') {
          existing.completed++;
        } else if (job.status === 'failed') {
          existing.failed++;
        }
      }
    });

    const dailyDeployments: DailyDeployment[] = Array.from(dailyMap.entries())
      .map(([date, counts]) => ({
        date,
        completed: counts.completed,
        failed: counts.failed,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Get top deployed apps
    const appCounts = new Map<string, { displayName: string; publisher: string; count: number }>();

    allJobs
      .filter((j) => j.status === 'completed')
      .forEach((job) => {
        const existing = appCounts.get(job.winget_id);
        if (existing) {
          existing.count++;
        } else {
          appCounts.set(job.winget_id, {
            displayName: job.display_name,
            publisher: job.publisher || 'Unknown',
            count: 1,
          });
        }
      });

    const topApps: TopApp[] = Array.from(appCounts.entries())
      .map(([wingetId, data]) => ({
        wingetId,
        ...data,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Get recent failures
    const recentFailures: RecentFailure[] = allJobs
      .filter((j) => j.status === 'failed')
      .slice(0, 10)
      .map((job) => ({
        id: job.id,
        wingetId: job.winget_id,
        displayName: job.display_name,
        errorMessage: job.error_message || 'Unknown error',
        createdAt: job.created_at,
      }));

    // Summary stats
    const summary = {
      totalJobs: allJobs.length,
      completedJobs,
      failedJobs,
      pendingJobs: allJobs.filter((j) =>
        ['queued', 'packaging', 'uploading'].includes(j.status)
      ).length,
      successRate,
    };

    return NextResponse.json({
      summary,
      dailyDeployments,
      topApps,
      recentFailures,
      dateRange: {
        start: startDate.toISOString(),
        end: new Date().toISOString(),
        days,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}
