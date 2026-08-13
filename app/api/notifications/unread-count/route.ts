/**
 * Unread Notifications Count API
 * GET - Get the count of unread notifications for badge display
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';

/**
 * GET /api/notifications/unread-count
 * Get unread notification count for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Notifications live in user_notifications, a Supabase-only table with no
    // SQLite equivalent. Report an empty badge rather than crashing on
    // createServerClient(), which throws without Supabase config and made this
    // route answer 500 on every dashboard load in a self-hosted install.
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ unread_count: 0 });
    }

    const supabase = createServerClient();

    const { count, error } = await supabase
      .from('user_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.userId)
      .is('read_at', null);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch unread count' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      unread_count: count || 0,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
