/**
 * Detection Rule Feedback API Routes
 * POST - Submit feedback on detection rules
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import {
  feedbackSchema,
  validateInput,
  sanitizeText,
} from '@/lib/validators/community';
import {
  applyRateLimit,
  getUserKey,
  COMMUNITY_RATE_LIMIT,
} from '@/lib/rate-limit';
import type { Database } from '@/types/database';

type DetectionRuleFeedbackRow = Database['public']['Tables']['detection_rule_feedback']['Row'];
type DetectionRuleFeedbackInsert = Database['public']['Tables']['detection_rule_feedback']['Insert'];

/**
 * POST /api/community/detection-feedback
 * Submit feedback on an app's detection rules
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

    // Rate limit by user
    const rateLimitResponse = await applyRateLimit(
      getUserKey(user.userId),
      COMMUNITY_RATE_LIMIT
    );
    if (rateLimitResponse) return rateLimitResponse;

    // Parse and validate request body
    const body = await request.json();
    const validation = validateInput(feedbackSchema, body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { app_id, feedback_type, description, environment_info } = validation.data;

    const supabase = createServerClient();

    // Verify the app exists in curated_apps
    const { data: existingApp } = await supabase
      .from('curated_apps')
      .select('id, winget_id, name')
      .eq('winget_id', app_id)
      .single();

    if (!existingApp) {
      return NextResponse.json(
        { error: 'App not found' },
        { status: 404 }
      );
    }

    // Create the feedback
    const insertData: DetectionRuleFeedbackInsert = {
      app_id,
      user_id: user.userId,
      user_email: user.userEmail,
      feedback_type: feedback_type as DetectionRuleFeedbackInsert['feedback_type'],
      description: sanitizeText(description),
      environment_info: (environment_info as DetectionRuleFeedbackInsert['environment_info']) || null,
    };

    const { data: feedback, error: insertError } = await supabase
      .from('detection_rule_feedback')
      .insert(insertData)
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'You have already submitted this type of feedback for this app' },
          { status: 409 }
        );
      }
      console.error('[detection-feedback] Failed to submit feedback:', insertError.message);
      return NextResponse.json(
        { error: 'Failed to submit feedback' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        feedback,
        message: 'Thank you for your feedback! This helps us improve detection rules.',
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[detection-feedback] POST error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/community/detection-feedback
 * Get feedback for an app (admin only or own feedback)
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

    // Rate limit GET handler
    const getRateLimitResponse = await applyRateLimit(
      getUserKey(user.userId),
      COMMUNITY_RATE_LIMIT
    );
    if (getRateLimitResponse) return getRateLimitResponse;

    const { searchParams } = new URL(request.url);
    const appId = searchParams.get('app_id');
    const ownOnly = searchParams.get('own') === 'true';

    if (!appId) {
      return NextResponse.json(
        { error: 'app_id parameter is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    let query = supabase
      .from('detection_rule_feedback')
      .select('*')
      .eq('app_id', appId)
      .order('created_at', { ascending: false });

    // Users can only see their own feedback unless they're an admin
    if (ownOnly) {
      query = query.eq('user_id', user.userId);
    }

    const { data: feedback, error } = await query;

    if (error) {
      console.error('[detection-feedback] Failed to fetch feedback:', error.message);
      return NextResponse.json(
        { error: 'Failed to fetch feedback' },
        { status: 500 }
      );
    }

    // Filter to only show user's own feedback for non-admins
    const filteredFeedback = (feedback as DetectionRuleFeedbackRow[] | null)?.filter(
      (f) => f.user_id === user.userId
    ) || [];

    return NextResponse.json({ feedback: filteredFeedback });
  } catch (err) {
    console.error('[detection-feedback] GET error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
