/**
 * Mark Notifications as Read API
 * POST - Mark specific notifications as read
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';

/**
 * POST /api/notifications/mark-read
 * Mark specific notifications as read
 * Body: { notification_ids: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { notification_ids } = body;

    if (!Array.isArray(notification_ids) || notification_ids.length === 0) {
      return NextResponse.json(
        { error: 'notification_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    // Limit to 100 notifications per request
    if (notification_ids.length > 100) {
      return NextResponse.json(
        { error: 'Cannot mark more than 100 notifications at once' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Mark notifications as read, but only if they belong to the user
    const { error } = await supabase
      .from('user_notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', notification_ids)
      .eq('user_id', user.userId)
      .is('read_at', null);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to mark notifications as read' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      marked_count: notification_ids.length,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
