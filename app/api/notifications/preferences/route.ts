/**
 * Notification Preferences API Routes
 * GET - Get user's notification preferences
 * PUT - Update user's notification preferences
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { sendTestEmail, isEmailConfigured } from '@/lib/email/service';
import type {
  NotificationPreferences,
  NotificationPreferencesInput,
} from '@/types/notifications';
import type { Database } from '@/types/database';

type NotificationPreferencesRow = Database['public']['Tables']['notification_preferences']['Row'];
type NotificationPreferencesUpsert = Database['public']['Tables']['notification_preferences']['Insert'];

/**
 * GET /api/notifications/preferences
 * Get the user's notification preferences
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

    const supabase = createServerClient();

    // Get user's notification preferences
    const { data: preferences, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json(
        { error: 'Failed to fetch preferences' },
        { status: 500 }
      );
    }

    // If no preferences exist, return defaults
    if (!preferences) {
      const defaultPreferences: Partial<NotificationPreferences> = {
        user_id: user.userId,
        email_enabled: false,
        email_frequency: 'daily',
        email_address: null,
        notify_critical_only: false,
      };
      return NextResponse.json({
        preferences: defaultPreferences,
        isEmailConfigured: isEmailConfigured(),
      });
    }

    return NextResponse.json({
      preferences: preferences as NotificationPreferences,
      isEmailConfigured: isEmailConfigured(),
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/notifications/preferences
 * Update the user's notification preferences
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse request body
    const body: NotificationPreferencesInput & { sendTestEmail?: boolean } =
      await request.json();

    // Validate email frequency
    if (
      body.email_frequency &&
      !['immediate', 'daily', 'weekly'].includes(body.email_frequency)
    ) {
      return NextResponse.json(
        { error: 'Invalid email frequency' },
        { status: 400 }
      );
    }

    // Validate email address if provided
    if (body.email_address) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(body.email_address)) {
        return NextResponse.json(
          { error: 'Invalid email address' },
          { status: 400 }
        );
      }
    }

    const supabase = createServerClient();

    // Upsert notification preferences
    const updateData: NotificationPreferencesUpsert = {
      user_id: user.userId,
      ...(body.email_enabled !== undefined && { email_enabled: body.email_enabled }),
      ...(body.email_frequency && { email_frequency: body.email_frequency as NotificationPreferencesUpsert['email_frequency'] }),
      ...(body.email_address !== undefined && { email_address: body.email_address }),
      ...(body.notify_critical_only !== undefined && {
        notify_critical_only: body.notify_critical_only,
      }),
      updated_at: new Date().toISOString(),
    };

    const { data: preferences, error } = await supabase
      .from('notification_preferences')
      .upsert(updateData, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update preferences' },
        { status: 500 }
      );
    }

    // Send test email if requested and email is being enabled
    let testEmailResult = null;
    if (body.sendTestEmail && body.email_enabled) {
      const emailAddress = body.email_address || user.userEmail;
      if (emailAddress && isEmailConfigured()) {
        testEmailResult = await sendTestEmail(emailAddress);
      }
    }

    return NextResponse.json({
      preferences: (preferences as NotificationPreferencesRow) as NotificationPreferences,
      testEmailSent: testEmailResult?.success ?? false,
      testEmailError: testEmailResult?.error,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
