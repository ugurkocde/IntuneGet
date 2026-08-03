/**
 * Updates Refresh API Route
 * POST - Run an on-demand update scan and refresh cached update results
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseVersion } from '@/lib/version-compare';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getDatabase } from '@/lib/db';
import { parseAccessToken } from '@/lib/auth-utils';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { GET as getLiveIntuneUpdates } from '@/app/api/intune/apps/updates/route';
import { notifyUserOfPendingUpdates } from '@/lib/notifications/notify-user';
import type { AppUpdateInfo } from '@/types/inventory';

interface RefreshRequestBody {
  tenant_id?: string;
}

interface LiveUpdatesResponse {
  updates: AppUpdateInfo[];
  updateCount: number;
  checkedApps?: Array<{
    app: string;
    wingetId: string | null;
    result: string;
  }>;
}

function isCriticalUpdate(currentVersion: string, latestVersion: string): boolean {
  const current = parseVersion(currentVersion || '0.0.0');
  const latest = parseVersion(latestVersion || '0.0.0');
  return latest.major > current.major;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const user = await parseAccessToken(authHeader);
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as RefreshRequestBody;
    const requestedTenantId = body.tenant_id?.trim() || null;

    // The scan runs against the live route and the results are cached through
    // the db abstraction, so both work without Supabase. Only MSP tenant
    // resolution and the notification fan-out below still need it.
    const supabase = isSupabaseConfigured() ? createServerClient() : null;
    const db = getDatabase();

    let tenantId = user.tenantId;
    if (supabase) {
      const tenantResolution = await resolveTargetTenantId({
        supabase,
        userId: user.userId,
        tokenTenantId: user.tenantId,
        requestedTenantId,
      });

      if (tenantResolution.errorResponse) {
        return tenantResolution.errorResponse;
      }

      tenantId = tenantResolution.tenantId;
    }

    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authentication header is required' },
        { status: 401 }
      );
    }

    // Reuse the live Intune matching route, then sync results into update_check_results.
    // The live route calls the Graph API list endpoint which returns largeIcon data inline.
    const forwardHeaders = new Headers({
      Authorization: authHeader,
    });
    if (requestedTenantId && requestedTenantId !== user.tenantId) {
      forwardHeaders.set('X-MSP-Tenant-Id', requestedTenantId);
    }

    const liveRequest = new NextRequest(
      `${request.nextUrl.origin}/api/intune/apps/updates`,
      { headers: forwardHeaders }
    );
    const liveResponse = await getLiveIntuneUpdates(liveRequest);

    if (!liveResponse.ok) {
      const errorBody = await liveResponse.json().catch(() => ({ error: 'Live update check failed' }));
      return NextResponse.json(errorBody, { status: liveResponse.status });
    }

    const liveData = (await liveResponse.json()) as LiveUpdatesResponse;
    const now = new Date().toISOString();

    // Load the prior rows so the write can preserve per-user state that the
    // live scan knows nothing about. notified_at is kept for unchanged updates
    // but reset to null when latest_version changed - without the reset, a row
    // already notified for an older version keeps its notified_at and the next
    // version bump is never notified. dismissed_at is carried the same way, so
    // dismissing an update survives a refresh but a new version resurfaces it.
    const priorRows = await db.updateCheckResults.getByUserId(user.userId, tenantId);
    const priorMap = new Map<
      string,
      { latest_version: string; notified_at: string | null; dismissed_at: string | null }
    >();
    priorRows.forEach((r) =>
      priorMap.set(`${r.winget_id}:${r.intune_app_id}`, {
        latest_version: r.latest_version,
        notified_at: r.notified_at,
        dismissed_at: r.dismissed_at,
      })
    );

    const rows = liveData.updates
      .filter((update) => Boolean(update.wingetId))
      .filter((update) => update.currentVersion !== 'Unknown')
      .map((update) => {
        const prior = priorMap.get(`${update.wingetId as string}:${update.intuneApp.id}`);
        const unchanged = Boolean(prior && prior.latest_version === update.latestVersion);
        return {
          user_id: user.userId,
          tenant_id: tenantId,
          winget_id: update.wingetId as string,
          intune_app_id: update.intuneApp.id,
          display_name: update.intuneApp.displayName,
          current_version: update.currentVersion,
          latest_version: update.latestVersion,
          is_critical: isCriticalUpdate(update.currentVersion, update.latestVersion),
          is_managed: update.isManaged,
          large_icon_type: update.intuneApp.largeIcon?.type || null,
          large_icon_value: update.intuneApp.largeIcon?.value || null,
          notified_at: unchanged ? prior!.notified_at : null,
          dismissed_at: unchanged ? prior!.dismissed_at : null,
          detected_at: now,
          updated_at: now,
        };
      });

    // A refresh re-derives the whole picture for this tenant, so the cached
    // set is replaced rather than merged: an update that no longer appears in
    // the scan must disappear instead of lingering as a phantom.
    try {
      await db.updateCheckResults.replaceForUserAndTenant(user.userId, tenantId, rows);
    } catch (storeError) {
      const message = storeError instanceof Error ? storeError.message : 'unknown error';
      return NextResponse.json(
        { error: `Failed to store updates: ${message}` },
        { status: 500 }
      );
    }

    // Near-immediate notifications: if this refresh surfaced any new or changed
    // update (notified_at reset to null above), deliver to the user's channels
    // now instead of waiting for the daily cron. Force-send regardless of the
    // user's email frequency, since they just ran an on-demand check. Failures
    // here must not fail the refresh; the daily cron remains the backstop.
    const hasPendingNotifications = rows.some((row) => row.notified_at === null);
    let notified: { emailsSent: number; webhooksSent: number } | undefined;
    // Notification channels (email, webhooks) are Supabase-only; without it
    // the refresh still refreshes, it just has nowhere to notify.
    if (supabase && hasPendingNotifications) {
      try {
        const res = await notifyUserOfPendingUpdates(supabase, user.userId, {
          respectFrequency: false,
        });
        notified = { emailsSent: res.emailsSent, webhooksSent: res.webhooksSent };
      } catch (notifyError) {
        console.error(
          'On-demand update notification failed:',
          notifyError instanceof Error ? notifyError.message : notifyError
        );
      }
    }

    const activeKeys = new Set(rows.map((row) => `${row.winget_id}:${row.intune_app_id}`));
    const removedCount = priorRows.filter(
      (row) => !activeKeys.has(`${row.winget_id}:${row.intune_app_id}`)
    ).length;

    return NextResponse.json({
      success: true,
      refreshedCount: rows.length,
      removedCount,
      ...(notified ? { notified } : {}),
      updateCount: liveData.updateCount,
      matchingSummary: {
        totalChecked: liveData.checkedApps?.length || 0,
        noMatch: liveData.checkedApps?.filter((item) => item.result === 'No match found').length || 0,
        lowConfidenceSkipped: liveData.checkedApps?.filter((item) => item.result.includes('Low confidence')).length || 0,
        packageNotInCache: liveData.checkedApps?.filter((item) => item.result === 'Package not in cache').length || 0,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
