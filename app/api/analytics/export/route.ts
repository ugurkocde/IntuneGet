/**
 * Analytics Export API Route
 * Exports deployment data as CSV
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { parseAccessToken } from '@/lib/auth-utils';
import { CSV_UTF8_BOM, encodeCsvRow } from '@/lib/csv';

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
    interface PackagingJobExport {
      id: string;
      winget_id: string;
      display_name: string;
      publisher: string | null;
      version: string;
      architecture: string | null;
      installer_type: string;
      status: string;
      error_message: string | null;
      intune_app_id: string | null;
      created_at: string;
      completed_at: string | null;
    }

    // Get all jobs in date range
    const jobs = (await database.jobs.getByUserId(user.userId)).filter(
      (job) => new Date(job.created_at) >= startDate
    );

    // Build CSV
    const headers = [
      'Job ID',
      'Winget ID',
      'Display Name',
      'Publisher',
      'Version',
      'Architecture',
      'Installer Type',
      'Status',
      'Intune App ID',
      'Error Message',
      'Created At',
      'Completed At',
    ];

    const allJobs = (jobs || []) as PackagingJobExport[];
    const rows = allJobs.map((job) => [
      job.id,
      job.winget_id,
      job.display_name,
      job.publisher || '',
      job.version,
      job.architecture || '',
      job.installer_type || '',
      job.status,
      job.intune_app_id || '',
      // encodeCsvRow below quotes every column and neutralises formulas.
      job.error_message || '',
      job.created_at,
      job.completed_at || '',
    ]);

    // The byte order mark lets Excel read non-ASCII names as UTF-8.
    const csvContent = CSV_UTF8_BOM + [
      encodeCsvRow(headers),
      ...rows.map((row: string[]) => encodeCsvRow(row)),
    ].join('\n');

    // Return CSV response
    const filename = `intuneget-deployments-${new Date().toISOString().split('T')[0]}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to export data' },
      { status: 500 }
    );
  }
}
