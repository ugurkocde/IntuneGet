/**
 * Auto-Update History API Route
 * GET - Get auto-update history
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseServerConfigured } from '@/lib/supabase';
import { getDatabase, isSqliteMode } from '@/lib/db';
import { parseAccessToken } from '@/lib/auth-utils';
import type { AutoUpdateHistory, AutoUpdateHistoryWithPolicy } from '@/types/update-policies';

const VALID_HISTORY_STATUSES: AutoUpdateHistory['status'][] = [
  'pending',
  'packaging',
  'deploying',
  'completed',
  'failed',
  'cancelled',
];

interface AutoUpdateHistoryRow {
  id: string;
  policy_id: string;
  packaging_job_id: string | null;
  from_version: string;
  to_version: string;
  update_type: 'patch' | 'minor' | 'major';
  status: 'pending' | 'packaging' | 'deploying' | 'completed' | 'failed' | 'cancelled';
  error_message: string | null;
  triggered_at: string;
  completed_at: string | null;
  policy: {
    winget_id: string;
    tenant_id: string;
    user_id: string;
  };
  packaging_job?: {
    display_name: string;
  };
}

/**
 * GET /api/updates/history
 * Get auto-update history for the user
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

    const searchParams = request.nextUrl.searchParams;
    const tenantId = searchParams.get('tenant_id');
    const wingetId = searchParams.get('winget_id');
    const status = searchParams.get('status');
    // Normalize pagination so a malformed value cannot reach the database as NaN.
    const parsedLimit = parseInt(searchParams.get('limit') || '50', 10);
    const parsedOffset = parseInt(searchParams.get('offset') || '0', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

    if (isSqliteMode()) {
      const entries = await getDatabase().autoUpdateHistory.list(user.userId, {
        tenantId: tenantId ?? undefined,
        wingetId: wingetId ?? undefined,
        status:
          status && VALID_HISTORY_STATUSES.includes(status as AutoUpdateHistory['status'])
            ? (status as AutoUpdateHistory['status'])
            : undefined,
        limit,
        offset,
      });
      return NextResponse.json({
        history: entries,
        count: entries.length,
        hasMore: entries.length === limit,
      });
    }

    if (!isSupabaseServerConfigured()) {
      return NextResponse.json({
        history: [],
        count: 0,
        hasMore: false,
      });
    }

    const supabase = createServerClient();

    // First, get policy IDs for this user
    let policyQuery = supabase
      .from('app_update_policies')
      .select('id, winget_id, tenant_id')
      .eq('user_id', user.userId);

    if (tenantId) {
      policyQuery = policyQuery.eq('tenant_id', tenantId);
    }

    if (wingetId) {
      policyQuery = policyQuery.eq('winget_id', wingetId);
    }

    const { data: userPolicies, error: policyError } = await policyQuery;

    if (policyError) {
      return NextResponse.json(
        { error: 'Failed to fetch policies' },
        { status: 500 }
      );
    }

    if (!userPolicies || userPolicies.length === 0) {
      return NextResponse.json({
        history: [],
        count: 0,
        hasMore: false,
      });
    }

    const policyIds = userPolicies.map((p: { id: string }) => p.id);

    // Build history query
    let historyQuery = supabase
      .from('auto_update_history')
      .select(`
        *,
        policy:app_update_policies!policy_id(winget_id, tenant_id, user_id),
        packaging_job:packaging_jobs!packaging_job_id(display_name)
      `)
      .in('policy_id', policyIds)
      .order('triggered_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && ['pending', 'packaging', 'deploying', 'completed', 'failed', 'cancelled'].includes(status)) {
      historyQuery = historyQuery.eq('status', status as 'pending' | 'packaging' | 'deploying' | 'completed' | 'failed' | 'cancelled');
    }

    const { data: history, error: historyError, count } = await historyQuery;

    if (historyError) {
      return NextResponse.json(
        { error: 'Failed to fetch history' },
        { status: 500 }
      );
    }

    // Transform the data - cast to unknown first to handle Supabase's complex types
    const historyData = (history || []) as unknown as AutoUpdateHistoryRow[];
    const transformedHistory: AutoUpdateHistoryWithPolicy[] = historyData
      .filter((h) => h.policy?.user_id === user.userId)
      .map((h) => ({
        id: h.id,
        policy_id: h.policy_id,
        packaging_job_id: h.packaging_job_id,
        from_version: h.from_version,
        to_version: h.to_version,
        update_type: h.update_type,
        status: h.status,
        error_message: h.error_message,
        triggered_at: h.triggered_at,
        completed_at: h.completed_at,
        policy: {
          winget_id: h.policy.winget_id,
          tenant_id: h.policy.tenant_id,
        },
        display_name: h.packaging_job?.display_name,
      }));

    return NextResponse.json({
      history: transformedHistory,
      count: transformedHistory.length,
      hasMore: transformedHistory.length === limit,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Stats helper function (for internal use, not a route handler)
// To get stats, use the GET handler with ?stats=true query param
// or call this function directly from other server-side code
