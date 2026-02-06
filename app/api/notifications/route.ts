/**
 * Notifications API Routes
 * GET - List user notifications with pagination
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseAccessToken } from '@/lib/auth-utils';
import { getUserNotifications } from '@/lib/notification-service';

/**
 * GET /api/notifications
 * Get paginated notifications for the current user
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

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
    const unreadOnly = searchParams.get('unread_only') === 'true';

    const result = await getUserNotifications(user.userId, limit, unreadOnly);

    return NextResponse.json({
      notifications: result.notifications,
      unread_count: result.unread_count,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
