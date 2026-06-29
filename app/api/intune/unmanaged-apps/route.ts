/**
 * Unmanaged Apps API Route
 * Fetches detected apps from Intune and matches them to WinGet packages
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import { matchDiscoveredApp, filterUserApps, isSystemApp, normalizeAppName } from '@/lib/matching/app-matcher';
import { compareVersions } from '@/lib/version-compare';
import { getServicePrincipalToken, invalidateServicePrincipalToken } from '@/lib/intune/graph-client';
import type {
  GraphUnmanagedApp,
  UnmanagedApp,
  UnmanagedAppsResponse,
  UnmanagedAppsStats,
  MatchStatus
} from '@/types/unmanaged';
import type { Database, Json } from '@/types/database';

export const maxDuration = 300;

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
// Hard ceiling on a single Graph request. A heavily throttled tenant can leave
// the connection open instead of returning 429 promptly; without this an
// in-flight fetch would run toward the function's maxDuration and hang the tab
// (the root cause in #125). Aborting lets the caller fall back to cache/partial.
const PER_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Raised when the overall scan time budget is exhausted (a request was aborted
 * because the caller's deadline passed). The caller treats this like a partial
 * scan: serve cached data, a partial result, or a clear "try again" error -
 * never hang waiting on the full collection.
 */
class GraphScanTimeoutError extends Error {
  constructor(message = 'Discovered apps scan exceeded its time budget') {
    super(message);
    this.name = 'GraphScanTimeoutError';
  }
}

/**
 * Fetch with retry logic for Graph API rate limiting (429) and transient errors (5xx).
 * Respects Retry-After header; falls back to exponential backoff capped at 30s.
 *
 * Every request is bounded by an AbortSignal: a per-request timeout, plus the
 * caller's overall deadline. A stalled Graph connection is therefore aborted
 * rather than allowed to run the function to its maxDuration limit. When the
 * overall deadline is hit, a GraphScanTimeoutError is thrown so the caller can
 * fall back to cached/partial data.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 5,
  deadlineAt?: number
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      throw new GraphScanTimeoutError();
    }

    // Bound this request: abort on the per-request timeout, the overall
    // deadline, or any caller-supplied signal, whichever fires first.
    const signals = [AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS)];
    if (deadlineAt !== undefined) {
      // Past the deadline is already handled by the pre-check above; only add a
      // deadline signal when time remains (timeout(0) would fire immediately).
      const remaining = deadlineAt - Date.now();
      if (remaining > 0) {
        signals.push(AbortSignal.timeout(remaining));
      }
    }
    if (options.signal) {
      signals.push(options.signal);
    }

    let response: Response;
    try {
      response = await fetch(url, { ...options, signal: AbortSignal.any(signals) });
    } catch (err) {
      // Abort (per-request timeout / deadline) or a transient network error.
      // If the overall budget is gone, surface a typed timeout so the caller
      // falls back instead of hanging. Otherwise retry within budget.
      if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
        throw new GraphScanTimeoutError();
      }
      if (attempt === maxRetries) {
        throw err;
      }
      const delayMs = Math.min(Math.pow(2, attempt) * 1000, 30000);
      if (deadlineAt !== undefined && Date.now() + delayMs >= deadlineAt) {
        throw new GraphScanTimeoutError();
      }
      console.warn(
        `Graph API request error on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delayMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    const status = response.status;
    const isRetryable = status === 429 || status >= 500;
    if (!isRetryable || attempt === maxRetries) {
      return response;
    }

    // Consume body to prevent memory leaks in serverless
    await response.text().catch(() => {});

    const retryAfter = response.headers.get('Retry-After');
    let delayMs: number;
    if (retryAfter) {
      const parsed = Number(retryAfter);
      delayMs = Number.isNaN(parsed) ? Math.pow(2, attempt) * 1000 : parsed * 1000;
    } else {
      delayMs = Math.pow(2, attempt) * 1000;
    }
    delayMs = Math.min(delayMs, 30000);

    // Stop retrying if the backoff would run past the caller's overall time
    // budget. Returning the throttled response lets the caller fall back to
    // cached data instead of a single page's retries blowing the whole budget.
    if (deadlineAt !== undefined && Date.now() + delayMs >= deadlineAt) {
      return response;
    }

    console.warn(
      `Graph API ${status} on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delayMs}ms`
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // Unreachable: loop always returns on attempt === maxRetries
  throw new Error('Failed to fetch data from Intune');
}

// Database row types from Database types
type DiscoveredAppCacheRow = Database['public']['Tables']['discovered_apps_cache']['Row'];
type ClaimedAppRow = Pick<Database['public']['Tables']['claimed_apps']['Row'], 'discovered_app_id' | 'status'>;
type ManualMappingRow = Database['public']['Tables']['manual_app_mappings']['Row'];

/**
 * Build an UnmanagedAppsResponse from discovered_apps_cache rows, applying the
 * same claimed-app and system-app filtering as the live path. When staleReason
 * is provided, the response is flagged as stale cached data.
 */
async function buildCachedAppsResponse(
  supabase: ReturnType<typeof createServerClient>,
  tenantId: string,
  includeSystem: boolean,
  cachedApps: DiscoveredAppCacheRow[],
  staleReason?: string
): Promise<NextResponse> {
  // Get claimed apps for this tenant
  const { data: claimedApps } = await supabase
    .from('claimed_apps')
    .select('discovered_app_id, status')
    .eq('tenant_id', tenantId);

  const claimedMap = new Map(
    claimedApps?.map(c => [c.discovered_app_id, c.status]) || []
  );

  const apps: UnmanagedApp[] = cachedApps
    .filter(app => includeSystem || !isSystemApp(app.app_data as unknown as GraphUnmanagedApp))
    .filter(app => {
      // Only hide deployed apps - pending/deploying/failed should remain visible
      const status = claimedMap.get(app.discovered_app_id);
      return status !== 'deployed';
    })
    .map(cached => ({
      id: cached.id,
      discoveredAppId: cached.discovered_app_id,
      displayName: cached.display_name,
      version: cached.version,
      publisher: cached.publisher,
      deviceCount: cached.device_count,
      platform: cached.platform,
      matchStatus: cached.match_status as MatchStatus,
      matchedPackageId: cached.matched_package_id,
      matchedPackageName: null,
      matchConfidence: cached.match_confidence,
      isClaimed: claimedMap.has(cached.discovered_app_id),
      claimStatus: claimedMap.get(cached.discovered_app_id) as UnmanagedApp['claimStatus'],
      lastSynced: cached.last_synced,
    }));

  const lastSynced = cachedApps[0].last_synced;

  return NextResponse.json({
    apps,
    total: apps.length,
    lastSynced,
    fromCache: true,
    ...(staleReason
      ? { stale: true, staleReason, lastSyncedAt: lastSynced }
      : {}),
  } as UnmanagedAppsResponse);
}

/**
 * Serve cached apps (regardless of TTL expiry) when the live Graph fetch
 * fails. Returns null when the cache has no rows for the tenant.
 */
async function tryStaleCacheFallback(
  supabase: ReturnType<typeof createServerClient>,
  tenantId: string,
  includeSystem: boolean,
  failureSummary: string
): Promise<NextResponse | null> {
  const { data: cachedApps } = await supabase
    .from('discovered_apps_cache')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('device_count', { ascending: false });

  if (!cachedApps || cachedApps.length === 0) {
    return null;
  }

  const lastSynced = cachedApps[0].last_synced;
  console.warn(
    `Serving stale discovered apps cache for tenant ${tenantId}: ${failureSummary}`
  );

  return buildCachedAppsResponse(
    supabase,
    tenantId,
    includeSystem,
    cachedApps,
    `${failureSummary}; showing cached data from ${lastSynced}`
  );
}

export async function GET(request: NextRequest) {
  // Context for serving stale cached data when the live Graph fetch fails
  let staleFallbackContext: {
    supabase: ReturnType<typeof createServerClient>;
    tenantId: string;
    includeSystem: boolean;
  } | null = null;

  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get query params
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === 'true';
    const includeSystem = searchParams.get('includeSystem') === 'true';

    const supabase = isSupabaseConfigured() ? createServerClient() : null;
    let tenantId: string;

    if (supabase) {
      const mspTenantId = request.headers.get('X-MSP-Tenant-Id');

      const tenantResolution = await resolveTargetTenantId({
        supabase,
        userId: user.userId,
        tokenTenantId: user.tenantId,
        requestedTenantId: mspTenantId,
      });

      if (tenantResolution.errorResponse) {
        return tenantResolution.errorResponse;
      }

      tenantId = tenantResolution.tenantId;
      staleFallbackContext = { supabase, tenantId, includeSystem };

      // Verify admin consent
      const { data: consentData, error: consentError } = await supabase
        .from('tenant_consent')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .single();

      if (consentError || !consentData) {
        return NextResponse.json(
          { error: 'Admin consent not found. Please complete the admin consent flow.' },
          { status: 403 }
        );
      }

      // Check cache first (unless force refresh). Serve any cached data we have -
      // fresh when within the TTL, otherwise the last sync marked stale - so
      // opening the Discovered Apps tab returns immediately. A full Graph re-scan
      // can run for minutes on large tenants, so we never block a normal page load
      // on it; the user refreshes explicitly (forceRefresh) to pull the latest,
      // and that path is time-bounded below. Only when there is no cached data at
      // all do we fetch inline here.
      if (!forceRefresh) {
        const { data: cachedApps } = await supabase
          .from('discovered_apps_cache')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('device_count', { ascending: false });

        if (cachedApps && cachedApps.length > 0) {
          const lastSynced = new Date(cachedApps[0].last_synced).getTime();
          const isCacheValid = Date.now() - lastSynced < CACHE_DURATION_MS;

          return buildCachedAppsResponse(
            supabase,
            tenantId,
            includeSystem,
            cachedApps,
            isCacheValid
              ? undefined
              : 'Showing the last synced results. Use Refresh to fetch the latest.'
          );
        }
      }
    } else {
      // Self-hosted sqlite mode: single tenant from the access token. No consent
      // cache (the service-principal token acquired next proves consent) and no
      // discovered-apps cache, so this always runs a live, cache-less scan.
      tenantId = user.tenantId;
    }

    // Fetch fresh data from Graph API
    const graphToken = await getServicePrincipalToken(tenantId);
    if (!graphToken) {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    // Fetch unmanaged apps with pagination.
    // Note: no $orderby — server-side sorting of the full detectedApps collection
    // is expensive and a frequent throttling (429) trigger. We re-sort by device
    // count in code after consolidation instead.
    // $top=1000: detectedApps honors page sizes well above the old default of 100
    // (verified against Graph). A larger page size means far fewer sequential
    // requests on large tenants, which both reduces 429 throttling and avoids the
    // 300s function timeout that otherwise surfaces as a generic fetch failure.
    // Graph caps the page size server-side if needed and returns @odata.nextLink,
    // which the loop below already follows.
    // Bound the live scan so an extremely large tenant cannot run the function
    // toward its 300s limit and make the client appear to hang. If we run out of
    // budget mid-pagination we stop and fall back to the last cache (or return
    // the partial set we collected) rather than waiting for the full scan.
    const FETCH_BUDGET_MS = 45_000;
    const fetchStartedAt = Date.now();
    let budgetExceeded = false;

    const graphApps: GraphUnmanagedApp[] = [];
    let nextUrl: string | null = `${GRAPH_API_BASE}/deviceManagement/detectedApps?$top=1000`;

    while (nextUrl) {
      let graphResponse: Response;
      try {
        graphResponse = await fetchWithRetry(
          nextUrl,
          {
            headers: {
              Authorization: `Bearer ${graphToken}`,
              'Content-Type': 'application/json',
            },
          },
          5,
          fetchStartedAt + FETCH_BUDGET_MS
        );
      } catch (err) {
        // Ran out of the overall time budget mid-request (a stalled/throttled
        // page was aborted). Stop paging and fall back to cache/partial below
        // instead of letting the request hang toward maxDuration.
        if (err instanceof GraphScanTimeoutError) {
          budgetExceeded = true;
          break;
        }
        throw err;
      }

      if (!graphResponse.ok) {
        // Invalidate cached token on 401 (revoked/expired)
        if (graphResponse.status === 401) {
          invalidateServicePrincipalToken(tenantId);
        }

        const errorText = await graphResponse.text();

        // Check for permission error
        if (graphResponse.status === 403 && errorText.includes('DeviceManagementManagedDevices')) {
          return NextResponse.json(
            {
              error: 'Missing required permission: DeviceManagementManagedDevices.Read.All. Please add this permission to your Azure AD app registration and grant admin consent.',
              permissionRequired: 'DeviceManagementManagedDevices.Read.All'
            },
            { status: 403 }
          );
        }

        // Fall back to cached data (even if expired) before surfacing the error
        const failureSummary = graphResponse.status === 429
          ? 'Intune API throttled (429)'
          : `Intune API request failed (${graphResponse.status})`;
        if (supabase) {
          const staleResponse = await tryStaleCacheFallback(
            supabase,
            tenantId,
            includeSystem,
            failureSummary
          );
          if (staleResponse) {
            return staleResponse;
          }
        }

        const errorMessage = graphResponse.status === 429
          ? 'Microsoft Graph is throttling requests for this tenant (429). This can happen on large tenants or right after several syncs. Please wait a minute and try again.'
          : `Failed to fetch apps from Intune (${graphResponse.status})`;
        return NextResponse.json(
          { error: errorMessage },
          { status: graphResponse.status }
        );
      }

      const graphData: { value: Record<string, unknown>[]; '@odata.nextLink'?: string } = await graphResponse.json();
      const pageApps = (graphData.value || []).map((app) => ({
        id: app.id as string,
        displayName: app.displayName as string,
        version: app.version as string | null,
        publisher: app.publisher as string | null,
        deviceCount: app.deviceCount as number,
        platform: mapPlatform(app.platform as string),
        sizeInByte: app.sizeInByte as number | undefined,
      }));

      graphApps.push(...pageApps);
      nextUrl = graphData['@odata.nextLink'] || null;

      if (nextUrl && Date.now() - fetchStartedAt > FETCH_BUDGET_MS) {
        budgetExceeded = true;
        break;
      }

      if (nextUrl) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    // Ran out of time budget on a very large tenant: prefer the last complete
    // cache over a slow partial scan. If there is no cache to fall back to, we
    // continue with the partial set below but do not persist or prune the cache,
    // so a later refresh can still seed it with a complete scan.
    if (budgetExceeded && supabase) {
      const staleResponse = await tryStaleCacheFallback(
        supabase,
        tenantId,
        includeSystem,
        'The discovered apps scan is taking longer than usual on this tenant'
      );
      if (staleResponse) {
        return staleResponse;
      }
    }

    // Budget ran out before a single page came back and there is no cache to
    // fall back to (e.g. a first load on a heavily throttled tenant). Returning
    // an empty "partial" list would look like the tenant has no apps, so surface
    // an actionable throttling error instead.
    if (budgetExceeded && graphApps.length === 0) {
      return NextResponse.json(
        {
          error:
            'Microsoft Graph is throttling this tenant, so the discovered apps scan timed out. This is common on large tenants right after several syncs. Please wait a minute and try Refresh again.',
        },
        { status: 503 }
      );
    }

    // Consolidate apps: group by normalized name+publisher, keep newest version, sum device counts
    const appGroups = new Map<string, GraphUnmanagedApp>();
    // Track every detected-app id merged into each group, keyed by group key.
    // The consolidated app only keeps the newest version's id, but the device
    // drill-down must fan out across all versions to list every device.
    const groupMemberIds = new Map<string, string[]>();
    for (const app of graphApps) {
      const key = `${normalizeAppName(app.displayName)}::${(app.publisher || '').toLowerCase().trim()}`;
      const existing = appGroups.get(key);
      if (!existing) {
        appGroups.set(key, { ...app });
        groupMemberIds.set(key, [app.id]);
      } else {
        existing.deviceCount += app.deviceCount;
        groupMemberIds.get(key)!.push(app.id);
        if (app.version && (!existing.version || compareVersions(app.version, existing.version) > 0)) {
          existing.id = app.id;
          existing.displayName = app.displayName;
          existing.version = app.version;
        }
      }
    }
    // Sort by consolidated device count (descending). Done in code since the
    // Graph query no longer uses $orderby (avoids throttling); this also orders
    // by the true per-app total rather than any single version's count.
    const consolidatedApps = [...appGroups.values()].sort(
      (a, b) => b.deviceCount - a.deviceCount
    );

    // Re-key the merged ids by the consolidated winner's id so the cache write
    // can attach the full version list to each app (fallback handled on read).
    // Winner ids are unique across groups (each detected-app id belongs to one
    // group), but merge defensively so a collision could never drop a version.
    const mergedIdsByWinnerId = new Map<string, string[]>();
    for (const [key, group] of appGroups) {
      const ids = groupMemberIds.get(key) ?? [group.id];
      const existing = mergedIdsByWinnerId.get(group.id);
      mergedIdsByWinnerId.set(group.id, existing ? [...new Set([...existing, ...ids])] : ids);
    }

    // Filter to Windows apps only
    const windowsApps = consolidatedApps.filter(app => app.platform === 'windows');

    // Filter user apps (remove system/framework apps) unless includeSystem
    const filteredApps = includeSystem ? windowsApps : filterUserApps(windowsApps);

    // Match apps to WinGet packages
    const now = new Date().toISOString();
    const unmanagedApps: UnmanagedApp[] = [];

    // Get claimed apps + manual mappings. In sqlite mode there is no Supabase to
    // query, so these stay empty: every app is unclaimed and auto-matched.
    const claimedMap = new Map<string, string>();
    const manualMappingMap = new Map<string, ManualMappingRow>();

    if (supabase) {
      const { data: claimedApps } = await supabase
        .from('claimed_apps')
        .select('discovered_app_id, status')
        .eq('tenant_id', tenantId);

      for (const c of claimedApps || []) {
        claimedMap.set(c.discovered_app_id, c.status);
      }

      // Get manual mappings for this tenant
      const { data: manualMappings } = await supabase
        .from('manual_app_mappings')
        .select('*')
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`);

      for (const m of manualMappings || []) {
        manualMappingMap.set(m.discovered_app_name.toLowerCase(), m);
      }
    }

    // Process each app
    for (const app of filteredApps) {
      // Check for manual mapping first
      const normalizedName = app.displayName.toLowerCase().trim();
      const manualMapping = manualMappingMap.get(normalizedName);

      let matchResult;
      if (manualMapping) {
        matchResult = {
          status: 'matched' as const,
          wingetId: manualMapping.winget_package_id,
          wingetName: null,
          confidence: 1.0,
          partialMatches: [],
        };
      } else {
        matchResult = matchDiscoveredApp(app);
      }

      unmanagedApps.push({
        id: `${tenantId}-${app.id}`,
        discoveredAppId: app.id,
        displayName: app.displayName,
        version: app.version,
        publisher: app.publisher,
        deviceCount: app.deviceCount,
        platform: app.platform,
        matchStatus: matchResult.status,
        matchedPackageId: matchResult.wingetId,
        matchedPackageName: matchResult.wingetName,
        matchConfidence: matchResult.confidence,
        partialMatches: matchResult.partialMatches,
        isClaimed: claimedMap.has(app.id),
        claimStatus: claimedMap.get(app.id) as UnmanagedApp['claimStatus'],
        lastSynced: now,
      });
    }

    // Update cache (upsert)
    type DiscoveredAppsCacheInsert = Database['public']['Tables']['discovered_apps_cache']['Insert'];
    const cacheRecords: DiscoveredAppsCacheInsert[] = unmanagedApps.map(app => ({
      user_id: user.userId,
      tenant_id: tenantId,
      discovered_app_id: app.discoveredAppId,
      display_name: app.displayName,
      version: app.version,
      publisher: app.publisher,
      device_count: app.deviceCount,
      platform: app.platform,
      matched_package_id: app.matchedPackageId,
      match_confidence: app.matchConfidence,
      match_status: app.matchStatus,
      // Store the winner GraphUnmanagedApp plus every detected-app id merged
      // into this group, so the device drill-down can fan out across versions.
      app_data: {
        ...(filteredApps.find(a => a.id === app.discoveredAppId) as unknown as Record<string, unknown>),
        mergedAppIds: mergedIdsByWinnerId.get(app.discoveredAppId) ?? [app.discoveredAppId],
      } as unknown as Json,
      last_synced: now,
    }));

    // Persist the scan results. Both complete and partial scans upsert their
    // rows, so a heavily throttled tenant that can never finish a full scan in
    // one request (the #125 case) still accumulates a usable cache across
    // retries instead of discarding every incomplete pass. The difference is
    // pruning: only a complete scan removes rows from previous syncs, because a
    // partial scan never reached most apps and pruning would wrongly delete
    // them. Upsert-then-prune (rather than delete-then-insert) also avoids a
    // race where concurrent requests see an empty cache and both hit Graph.
    if (supabase) {
      if (cacheRecords.length > 0) {
        await supabase
          .from('discovered_apps_cache')
          .upsert(cacheRecords, { onConflict: 'tenant_id,discovered_app_id' });
      }

      // Remove entries from previous syncs that are no longer present. Complete
      // scans only - a partial scan's coverage is incomplete by definition.
      // This runs even when the complete scan found zero apps, so a tenant that
      // genuinely emptied out (every app uninstalled/now managed) is pruned
      // rather than left showing phantom rows from an earlier sync.
      if (!budgetExceeded) {
        await supabase
          .from('discovered_apps_cache')
          .delete()
          .eq('tenant_id', tenantId)
          .lt('last_synced', now);
      }
    }

    // Only hide deployed apps - pending/deploying/failed should remain visible
    const visibleApps = unmanagedApps.filter(app => {
      const status = claimedMap.get(app.discoveredAppId);
      return status !== 'deployed';
    });

    return NextResponse.json({
      apps: visibleApps,
      total: visibleApps.length,
      lastSynced: now,
      fromCache: false,
      ...(budgetExceeded
        ? {
            stale: true,
            staleReason:
              'Showing a partial result; this tenant has too many apps to scan in one request. Use Refresh to continue.',
          }
        : {}),
    } as UnmanagedAppsResponse);
  } catch (error) {
    console.error('Unmanaged apps API error:', error);

    // Fall back to cached data (even if expired) before surfacing the error
    if (staleFallbackContext) {
      const staleResponse = await tryStaleCacheFallback(
        staleFallbackContext.supabase,
        staleFallbackContext.tenantId,
        staleFallbackContext.includeSystem,
        error instanceof Error ? error.message : 'Failed to fetch unmanaged apps'
      ).catch(() => null);
      if (staleResponse) {
        return staleResponse;
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch unmanaged apps' },
      { status: 500 }
    );
  }
}

/**
 * Get statistics for unmanaged apps
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

    const supabase = isSupabaseConfigured() ? createServerClient() : null;

    if (!supabase) {
      // Self-hosted sqlite mode: no discovered_apps_cache to aggregate, so there
      // are no stats to compute. Return a zeroed result.
      const emptyStats: UnmanagedAppsStats = {
        total: 0,
        matched: 0,
        partial: 0,
        unmatched: 0,
        claimed: 0,
        totalDevices: 0,
      };
      return NextResponse.json(emptyStats);
    }

    const mspTenantId = request.headers.get('X-MSP-Tenant-Id');

    const tenantResolution = await resolveTargetTenantId({
      supabase,
      userId: user.userId,
      tokenTenantId: user.tenantId,
      requestedTenantId: mspTenantId,
    });

    if (tenantResolution.errorResponse) {
      return tenantResolution.errorResponse;
    }

    const tenantId = tenantResolution.tenantId;

    // Get cached apps
    const { data: cachedApps } = await supabase
      .from('discovered_apps_cache')
      .select('match_status, device_count, discovered_app_id, display_name, publisher, matched_package_id')
      .eq('tenant_id', tenantId);

    // Get claimed apps with status
    const { data: claimedApps } = await supabase
      .from('claimed_apps')
      .select('discovered_app_id, status')
      .eq('tenant_id', tenantId);

    const claimedMap = new Map(
      claimedApps?.map(c => [c.discovered_app_id, c.status]) || []
    );

    // Filter cached apps to exclude deployed apps and Microsoft apps for stats calculation
    // Only deployed apps are hidden - pending/deploying/failed remain visible
    const visibleApps = cachedApps?.filter(a => {
      // Only exclude deployed apps (not pending/deploying/failed)
      const status = claimedMap.get(a.discovered_app_id);
      if (status === 'deployed') return false;

      // Exclude Microsoft apps (consistent with frontend filtering)
      const publisherLower = (a.publisher || '').toLowerCase();
      const packageIdLower = (a.matched_package_id || '').toLowerCase();
      const displayNameLower = (a.display_name || '').toLowerCase();

      const isMicrosoft =
        publisherLower.includes('microsoft') ||
        packageIdLower.startsWith('microsoft.') ||
        displayNameLower.startsWith('microsoft ');

      return !isMicrosoft;
    }) || [];

    const stats: UnmanagedAppsStats = {
      total: visibleApps.length,
      matched: visibleApps.filter(a => a.match_status === 'matched').length,
      partial: visibleApps.filter(a => a.match_status === 'partial').length,
      unmatched: visibleApps.filter(a => a.match_status === 'unmatched').length,
      claimed: Array.from(claimedMap.values()).filter(s => s === 'deployed').length,  // Only count deployed
      totalDevices: visibleApps.reduce((sum, a) => sum + (a.device_count || 0), 0),
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Unmanaged apps stats API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}

/**
 * Map Graph API platform string to our format
 */
function mapPlatform(platform: string | undefined): GraphUnmanagedApp['platform'] {
  switch (platform?.toLowerCase()) {
    case 'windows':
      return 'windows';
    case 'macos':
    case 'macosx':
      return 'macOS';
    case 'android':
      return 'android';
    case 'ios':
      return 'iOS';
    default:
      return 'unknown';
  }
}

// Service-principal token acquisition (with per-tenant caching and federated
// credential support) is shared from lib/intune/graph-client.
