/**
 * Community App Suggestions API Routes
 * GET - List app suggestions with filtering and pagination
 * POST - Submit a new app suggestion
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import {
  suggestionSchema,
  suggestionsQuerySchema,
  validateInput,
  sanitizeText,
} from '@/lib/validators/community';
import {
  applyRateLimit,
  getUserKey,
  getIpKey,
  COMMUNITY_RATE_LIMIT,
  PUBLIC_RATE_LIMIT,
} from '@/lib/rate-limit';

/**
 * GET /api/community/suggestions
 * List app suggestions with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limit by IP for public access
    const rateLimitResponse = await applyRateLimit(getIpKey(request), PUBLIC_RATE_LIMIT);
    if (rateLimitResponse) return rateLimitResponse;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const queryValidation = validateInput(suggestionsQuerySchema, {
      status: searchParams.get('status') || 'pending',
      sort: searchParams.get('sort') || 'votes',
      page: searchParams.get('page') || '1',
      limit: searchParams.get('limit') || '20',
    });

    if (!queryValidation.success) {
      return NextResponse.json(
        { error: queryValidation.error },
        { status: 400 }
      );
    }

    const { status, sort, page, limit } = queryValidation.data;
    const offset = (page - 1) * limit;

    const supabase = createServerClient();

    // Build query
    let query = supabase
      .from('app_suggestions')
      .select('*', { count: 'exact' });

    // Filter by status
    if (status !== 'all') {
      query = query.eq('status', status);
    }

    // Sort
    switch (sort) {
      case 'newest':
        query = query.order('created_at', { ascending: false });
        break;
      case 'oldest':
        query = query.order('created_at', { ascending: true });
        break;
      case 'votes':
      default:
        query = query.order('votes_count', { ascending: false });
        break;
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: suggestions, error, count } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch suggestions' },
        { status: 500 }
      );
    }

    // Get current user's votes if authenticated
    const user = await parseAccessToken(request.headers.get('Authorization'));
    let userVotes: string[] = [];

    if (user && suggestions && suggestions.length > 0) {
      const suggestionIds = suggestions.map((s) => s.id);
      const { data: votes } = await supabase
        .from('app_suggestion_votes')
        .select('suggestion_id')
        .eq('user_id', user.userId)
        .in('suggestion_id', suggestionIds);

      if (votes) {
        userVotes = votes.map((v) => v.suggestion_id);
      }
    }

    return NextResponse.json({
      suggestions: suggestions || [],
      userVotes,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/community/suggestions
 * Submit a new app suggestion
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
    const validation = validateInput(suggestionSchema, body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { winget_id, reason } = validation.data;

    const supabase = createServerClient();

    // Check if this WinGet ID was already suggested
    const { data: existing } = await supabase
      .from('app_suggestions')
      .select('id, status')
      .eq('winget_id', winget_id)
      .in('status', ['pending', 'approved'])
      .single();

    if (existing) {
      return NextResponse.json(
        {
          error: 'This app has already been suggested',
          existingSuggestionId: existing.id,
          status: existing.status,
        },
        { status: 409 }
      );
    }

    // Check if app already exists in curated_apps
    const { data: existingApp } = await supabase
      .from('curated_apps')
      .select('id')
      .eq('winget_id', winget_id)
      .single();

    if (existingApp) {
      return NextResponse.json(
        { error: 'This app is already available in IntuneGet' },
        { status: 409 }
      );
    }

    // Create the suggestion
    const { data: suggestion, error: insertError } = await supabase
      .from('app_suggestions')
      .insert({
        winget_id,
        suggested_by_user_id: user.userId,
        suggested_by_email: user.userEmail,
        reason: sanitizeText(reason),
        votes_count: 1, // Auto-vote by the submitter
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: 'Failed to create suggestion' },
        { status: 500 }
      );
    }

    // Auto-vote for the suggestion by the submitter
    await supabase
      .from('app_suggestion_votes')
      .insert({
        suggestion_id: suggestion.id,
        user_id: user.userId,
        user_email: user.userEmail,
      });

    return NextResponse.json(
      { suggestion },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
