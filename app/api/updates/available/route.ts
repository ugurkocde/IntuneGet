/**
 * Available Updates API Route
 * GET - Get all available updates with policy information
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getDatabase } from '@/lib/db';
import { parseAccessToken } from '@/lib/auth-utils';
import { compareVersions } from '@/lib/version-compare';
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
    const tenantId = searchParams.get('tenant_id')?.trim() || null;
    const includeDismissed = searchParams.get('include_dismissed') === 'true';
    const criticalOnly = searchParams.get('critical_only') === 'true';
    // By default only surface updates for IntuneGet-managed apps; fuzzy-matched
    // apps are opt-in to avoid accidentally updating mismatched/customized apps.
    const includeUnmanaged = searchParams.get('include_unmanaged') === 'true';

    // Detected updates live in the db abstraction, so this works in both
    // backends. Auto-update policies below are Supabase-only.
    const supabase = isSupabaseConfigured() ? createServerClient() : null;

    let updates;
    try {
      updates = await getDatabase().updateCheckResults.getByUserId(user.userId, tenantId);
    } catch {
      return NextResponse.json(
        { error: 'Failed to fetch updates' },
        { status: 500 }
      );
    }

    if (!includeDismissed) {
      updates = updates.filter((update) => update.dismissed_at === null);
    }

    if (criticalOnly) {
      updates = updates.filter((update) => update.is_critical);
    }

    if (updates.length === 0) {
      return NextResponse.json({
        updates: [],
        count: 0,
        criticalCount: 0,
      });
    }

    // Get policies for these updates. Auto-update policies are a Supabase-only
    // feature (app_update_policies has no SQLite equivalent, and there is no
    // scheduler to act on them in a self-hosted container), so without
    // Supabase every update simply reports no policy.
    const wingetIds = [...new Set(updates.map((u) => u.winget_id))];
    const { data: policies } = supabase
      ? await (() => {
          let policiesQuery = supabase
            .from('app_update_policies')
            .select('id, winget_id, tenant_id, policy_type, is_enabled, pinned_version, last_auto_update_at, last_auto_update_version, consecutive_failures')
            .eq('user_id', user.userId)
            .in('winget_id', wingetIds);

          if (tenantId) {
            policiesQuery = policiesQuery.eq('tenant_id', tenantId);
          }

          return policiesQuery;
        })()
      : { data: null };

    // Deployment history tells us which apps went out through IntuneGet; it
    // exists in both backends. Query per tenant rather than fetching a capped
    // page of the user's whole history and filtering here - has_prior_deployment
    // reads a missing row as "never deployed", so a truncated page would be a
    // wrong answer rather than a shorter one. The tenants involved are bounded
    // by the updates themselves (one, outside MSP setups).
    const tenantsInPlay = [...new Set(updates.map((u) => u.tenant_id))];
    const deployedSet = new Set<string>();
    for (const tenant of tenantsInPlay) {
      const history = await getDatabase().uploadHistory.getByUserIdAndTenantId(
        user.userId,
        tenant
      );
      for (const row of history) {
        if (wingetIds.includes(row.winget_id)) {
          deployedSet.add(`${row.winget_id}:${tenant}`);
        }
      }
    }

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
          last_auto_update_version: policy.last_auto_update_version,
          consecutive_failures: policy.consecutive_failures,
        });
      });
    }

    // Combine updates with policy info and filter out Unknown versions
    const updatesWithPolicies: AvailableUpdate[] = updates
      .map((update) => {
        const policyKey = `${update.winget_id}:${update.tenant_id}`;
        return {
          ...update,
          is_managed: update.is_managed ?? true,
          has_prior_deployment: deployedSet.has(policyKey),
          policy: policyMap.get(policyKey) || null,
        };
      })
      .filter((u) => u.current_version !== 'Unknown')
      .filter((u) => compareVersions(u.current_version, u.latest_version) < 0)
      .filter((u) => u.policy?.last_auto_update_version !== u.latest_version)
      .filter((u) => includeUnmanaged || u.is_managed);

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

    // Dismissal is per-user state on a row the db abstraction owns, so it
    // works in both backends. The user id is part of every write, so one user
    // cannot dismiss another's row.
    const dismissedAt = action === 'dismiss' ? new Date().toISOString() : null;
    const db = getDatabase();

    let updated = 0;
    try {
      for (const id of update_ids as string[]) {
        const row = await db.updateCheckResults.setDismissedAt(id, user.userId, dismissedAt);
        if (row) {
          updated += 1;
        }
      }
    } catch {
      return NextResponse.json(
        { error: 'Failed to update updates' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      updated,
      action,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
