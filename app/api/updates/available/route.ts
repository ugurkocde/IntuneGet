/**
 * Available Updates API Route
 * GET - Get all available updates with policy information
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import type { AvailableUpdate } from '@/types/update-policies';

/**
 * GET /api/updates/available
 * Get all available updates for the user, with policy information
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
    const includeDismissed = searchParams.get('include_dismissed') === 'true';
    const criticalOnly = searchParams.get('critical_only') === 'true';

    const supabase = createServerClient();

    // Build query for update check results
    let query = supabase
      .from('update_check_results')
      .select('*')
      .eq('user_id', user.userId)
      .order('detected_at', { ascending: false });

    // Filter by tenant if specified
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    // Exclude dismissed unless requested
    if (!includeDismissed) {
      query = query.is('dismissed_at', null);
    }

    // Filter critical only
    if (criticalOnly) {
      query = query.eq('is_critical', true);
    }

    const { data: updates, error: updatesError } = await query;

    if (updatesError) {
      return NextResponse.json(
        { error: 'Failed to fetch updates' },
        { status: 500 }
      );
    }

    if (!updates || updates.length === 0) {
      return NextResponse.json({
        updates: [],
        count: 0,
        criticalCount: 0,
      });
    }

    // Get policies for these updates
    const wingetIds = [...new Set(updates.map((u) => u.winget_id))];
    const { data: policies } = await supabase
      .from('app_update_policies')
      .select('id, winget_id, tenant_id, policy_type, is_enabled, pinned_version, last_auto_update_at, consecutive_failures')
      .eq('user_id', user.userId)
      .in('winget_id', wingetIds);

    // Create policy lookup
    const policyMap = new Map<string, AvailableUpdate['policy']>();
    if (policies) {
      policies.forEach((policy) => {
        const key = `${policy.winget_id}:${policy.tenant_id}`;
        policyMap.set(key, {
          id: policy.id,
          policy_type: policy.policy_type,
          is_enabled: policy.is_enabled,
          pinned_version: policy.pinned_version,
          last_auto_update_at: policy.last_auto_update_at,
          consecutive_failures: policy.consecutive_failures,
        });
      });
    }

    // Combine updates with policy info
    const updatesWithPolicies: AvailableUpdate[] = updates.map((update) => {
      const policyKey = `${update.winget_id}:${update.tenant_id}`;
      return {
        ...update,
        policy: policyMap.get(policyKey) || null,
      };
    });

    // Count critical updates
    const criticalCount = updatesWithPolicies.filter((u) => u.is_critical).length;

    return NextResponse.json({
      updates: updatesWithPolicies,
      count: updatesWithPolicies.length,
      criticalCount,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/updates/available
 * Dismiss or un-dismiss updates
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { update_ids, action } = body;

    if (!update_ids || !Array.isArray(update_ids) || update_ids.length === 0) {
      return NextResponse.json(
        { error: 'update_ids array is required' },
        { status: 400 }
      );
    }

    if (!['dismiss', 'restore'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "dismiss" or "restore"' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const updateData = {
      dismissed_at: action === 'dismiss' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('update_check_results')
      .update(updateData)
      .in('id', update_ids)
      .eq('user_id', user.userId);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update updates' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      updated: update_ids.length,
      action,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
