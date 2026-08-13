/**
 * Analytics Export API Route
 * Exports deployment data as CSV
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { parseAccessToken } from '@/lib/auth-utils';

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


    // Same source as the Reports page itself: packaging_jobs through the db
    // abstraction, so the export works without Supabase as well.
    const startIso = startDate.toISOString();
    const jobs = (await getDatabase().jobs.getAllByUserId(user.userId)).filter(
      (job) => job.created_at >= startIso
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

    const rows = jobs.map((job) => [
      job.id,
      job.winget_id,
      job.display_name,
      job.publisher || '',
      job.version,
      job.architecture || '',
      job.installer_type || '',
      job.status,
      job.intune_app_id || '',
      // escapeCSV below handles quote-doubling uniformly for every column.
      job.error_message || '',
      job.created_at,
      job.completed_at || '',
    ]);

    // Escape CSV values
    const escapeCSV = (value: string): string => {
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        // RFC 4180: wrap in quotes and double any embedded quotes.
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [
      headers.map(escapeCSV).join(','),
      ...rows.map((row: string[]) => row.map(escapeCSV).join(',')),
    ].join('\n');

    // Return CSV response
    const filename = `intuneget-deployments-${new Date().toISOString().split('T')[0]}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
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
