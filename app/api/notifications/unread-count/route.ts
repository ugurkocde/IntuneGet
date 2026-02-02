/**
 * Unread Notifications Count API
 * GET - Get the count of unread notifications for badge display
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';

/**
 * GET /api/notifications/unread-count
 * Get unread notification count for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const user = parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (supabase as any)
      .from('user_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.userId)
      .is('read_at', null);

    if (error) {
      console.error('Error fetching unread count:', error);
      return NextResponse.json(
        { error: 'Failed to fetch unread count' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      unread_count: count || 0,
    });
  } catch (error) {
    console.error('Unread count GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
