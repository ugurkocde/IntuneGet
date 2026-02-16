/**
 * Packager Health Check API
 * Returns the health status of the local packager system
 * Also handles stale job recovery in SQLite mode
 */

import { NextResponse } from 'next/server';
import { getDatabase, getDatabaseMode } from '@/lib/db';
import { getFeatureFlags } from '@/lib/features';

interface PackagerStats {
  activePackagers: number;
  queuedJobs: number;
  processingJobs: number;
  recentCompletedJobs: number;
  recentFailedJobs: number;
  staleJobsRecovered?: number;
}

// Stale job timeout: 5 minutes (should match packager config)
const STALE_JOB_TIMEOUT_MS = 5 * 60 * 1000;

export async function GET() {
  try {
    const features = getFeatureFlags();

    if (!features.localPackager) {
      return NextResponse.json({
        status: 'disabled',
        message: 'Local packager mode is not enabled. Set PACKAGER_MODE=local to enable.',
      });
    }

    const db = getDatabase();
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_JOB_TIMEOUT_MS);

    // Recover stale jobs during health check
    // This acts as a periodic cleanup since there's no background worker
    let staleJobsRecovered = 0;
    const staleJobs = await db.jobs.getStaleJobs(staleThreshold);
    for (const job of staleJobs) {
      const released = await db.jobs.forceRelease(job.id);
      if (released) {
        staleJobsRecovered++;
      }
    }

    // Get job statistics
    const jobStats = await db.jobs.getStats();

    const stats: PackagerStats = {
      activePackagers: 0, // Will be calculated below
      queuedJobs: jobStats.queued,
      processingJobs: jobStats.packaging + jobStats.testing + jobStats.uploading,
      recentCompletedJobs: jobStats.deployed,
      recentFailedJobs: jobStats.failed,
    };

    if (staleJobsRecovered > 0) {
      stats.staleJobsRecovered = staleJobsRecovered;
    }

    // Determine overall health status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const issues: string[] = [];

    if (stats.queuedJobs > 0 && stats.processingJobs === 0) {
      status = 'unhealthy';
      issues.push('No active packagers but jobs are queued');
    } else if (stats.queuedJobs > 10) {
      status = 'degraded';
      issues.push('Large job queue - consider adding more packagers');
    }

    if (stats.recentFailedJobs > stats.recentCompletedJobs && stats.recentFailedJobs > 0) {
      status = status === 'healthy' ? 'degraded' : status;
      issues.push('More failures than successes');
    }

    return NextResponse.json({
      status,
      mode: 'local',
      databaseMode: getDatabaseMode(),
      timestamp: now.toISOString(),
      stats,
      issues: issues.length > 0 ? issues : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Failed to check packager health',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
