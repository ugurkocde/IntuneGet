/**
 * Track Sign-in API Route
 *
 * Called after successful Microsoft authentication to log sign-in events.
 * This provides visibility into authentication activity in Vercel logs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logPermissions } from '@/lib/permission-logger';

interface SignInTrackingPayload {
  userId: string;
  email: string;
  name: string | null;
  tenantId: string;
  authMethod: 'popup' | 'redirect' | 'silent';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const payload: SignInTrackingPayload = await request.json();

    const { userId, email, name, tenantId, authMethod } = payload;

    // Validate required fields
    if (!userId || !email || !tenantId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Log the sign-in event
    logPermissions({
      route: '/api/auth/track-signin',
      action: 'user_signed_in',
      tenantId,
      granted: true,
      details: {
        userId,
        email,
        name,
        authMethod,
        timestamp: new Date().toISOString(),
      },
    });

    // Additional structured log for easy filtering
    console.log(`[SIGN_IN] ${JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'user_signed_in',
      userId,
      email,
      name,
      tenantId,
      authMethod,
    })}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error tracking sign-in:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
