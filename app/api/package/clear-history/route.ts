/**
 * Clear History API Route
 * Soft-archives terminal packaging jobs for the authenticated user
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { parseAccessToken } from '@/lib/auth-utils';

const DEFAULT_TERMINAL_STATUSES = ['completed', 'deployed', 'failed', 'cancelled', 'duplicate_skipped'];

export async function POST(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse optional statuses from request body
    let statuses = DEFAULT_TERMINAL_STATUSES;
    try {
      const body = await request.json();
      if (Array.isArray(body.statuses) && body.statuses.length > 0) {
        // Only allow valid terminal statuses
        statuses = body.statuses.filter((s: unknown) =>
          typeof s === 'string' && DEFAULT_TERMINAL_STATUSES.includes(s)
        );
        if (statuses.length === 0) {
          return NextResponse.json(
            { error: 'No valid terminal statuses provided' },
            { status: 400 }
          );
        }
      }
    } catch {
      // Body is optional, use defaults
    }

    const db = getDatabase();
    const archivedCount = await db.jobs.deleteByUserIdAndStatuses(user.userId, statuses);

    return NextResponse.json({
      success: true,
      archivedCount,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
