/**
 * Community App Suggestion Vote API Routes
 * POST - Vote for a suggestion
 * DELETE - Remove vote from a suggestion
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { isValidUuid } from '@/lib/validators/community';
import {
  applyRateLimit,
  getUserKey,
  COMMUNITY_RATE_LIMIT,
} from '@/lib/rate-limit';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/community/suggestions/[id]/vote
 * Add a vote to a suggestion
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

    const { id: suggestionId } = await params;

    // Validate suggestion ID format
    if (!isValidUuid(suggestionId)) {
      return NextResponse.json(
        { error: 'Invalid suggestion ID format' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Check if suggestion exists and is voteable
    const { data: suggestion, error: fetchError } = await supabase
      .from('app_suggestions')
      .select('id, status')
      .eq('id', suggestionId)
      .single();

    if (fetchError || !suggestion) {
      return NextResponse.json(
        { error: 'Suggestion not found' },
        { status: 404 }
      );
    }

    // Only allow voting on pending suggestions
    if (suggestion.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot vote on ${suggestion.status} suggestions` },
        { status: 400 }
      );
    }

    // Check if user already voted
    const { data: existingVote } = await supabase
      .from('app_suggestion_votes')
      .select('id')
      .eq('suggestion_id', suggestionId)
      .eq('user_id', user.userId)
      .single();

    if (existingVote) {
      return NextResponse.json(
        { error: 'You have already voted for this suggestion' },
        { status: 409 }
      );
    }

    // Create the vote (trigger will update votes_count)
    const { error: voteError } = await supabase
      .from('app_suggestion_votes')
      .insert({
        suggestion_id: suggestionId,
        user_id: user.userId,
        user_email: user.userEmail,
      });

    if (voteError) {
      // Handle unique constraint violation
      if (voteError.code === '23505') {
        return NextResponse.json(
          { error: 'You have already voted for this suggestion' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to add vote' },
        { status: 500 }
      );
    }

    // Get updated vote count
    const { data: updatedSuggestion } = await supabase
      .from('app_suggestions')
      .select('votes_count')
      .eq('id', suggestionId)
      .single();

    return NextResponse.json({
      success: true,
      votes_count: updatedSuggestion?.votes_count || 0,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/community/suggestions/[id]/vote
 * Remove a vote from a suggestion
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    const { id: suggestionId } = await params;

    // Validate suggestion ID format
    if (!isValidUuid(suggestionId)) {
      return NextResponse.json(
        { error: 'Invalid suggestion ID format' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Delete the vote (trigger will update votes_count)
    const { error: deleteError, count } = await supabase
      .from('app_suggestion_votes')
      .delete({ count: 'exact' })
      .eq('suggestion_id', suggestionId)
      .eq('user_id', user.userId);

    if (deleteError) {
      return NextResponse.json(
        { error: 'Failed to remove vote' },
        { status: 500 }
      );
    }

    if (count === 0) {
      return NextResponse.json(
        { error: 'Vote not found' },
        { status: 404 }
      );
    }

    // Get updated vote count
    const { data: updatedSuggestion } = await supabase
      .from('app_suggestions')
      .select('votes_count')
      .eq('id', suggestionId)
      .single();

    return NextResponse.json({
      success: true,
      votes_count: updatedSuggestion?.votes_count || 0,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
