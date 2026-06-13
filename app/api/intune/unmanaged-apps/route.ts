/**
 * Unmanaged Apps API Route
 * Fetches detected apps from Intune and matches them to WinGet packages
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import { matchDiscoveredApp, filterUserApps, isSystemApp, normalizeAppName } from '@/lib/matching/app-matcher';
import { compareVersions } from '@/lib/version-compare';
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

// Module-scoped token cache keyed by tenantId
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const tokenInflight = new Map<string, Promise<string | null>>();

/**
 * Fetch with retry logic for Graph API rate limiting (429) and transient errors (5xx).
 * Respects Retry-After header; falls back to exponential backoff capped at 30s.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
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

    const supabase = createServerClient();
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

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const { data: cachedApps } = await supabase
        .from('discovered_apps_cache')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('device_count', { ascending: false });

      if (cachedApps && cachedApps.length > 0) {
        const lastSynced = new Date(cachedApps[0].last_synced).getTime();
        const isCacheValid = Date.now() - lastSynced < CACHE_DURATION_MS;

        if (isCacheValid) {
          return buildCachedAppsResponse(supabase, tenantId, includeSystem, cachedApps);
        }
      }
    }

    // Fetch fresh data from Graph API
    const graphToken = await getServicePrincipalToken(tenantId);
    if (!graphToken) {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    // Fetch unmanaged apps with pagination
    const graphApps: GraphUnmanagedApp[] = [];
    let nextUrl: string | null = `${GRAPH_API_BASE}/deviceManagement/detectedApps?$top=100&$orderby=deviceCount desc`;

    while (nextUrl) {
      const graphResponse: Response = await fetchWithRetry(nextUrl, {
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!graphResponse.ok) {
        // Invalidate cached token on 401 (revoked/expired)
        if (graphResponse.status === 401) {
          tokenCache.delete(tenantId);
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
        const staleResponse = await tryStaleCacheFallback(
          supabase,
          tenantId,
          includeSystem,
          failureSummary
        );
        if (staleResponse) {
          return staleResponse;
        }

        return NextResponse.json(
          { error: `Failed to fetch apps from Intune (${graphResponse.status})` },
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

      if (nextUrl) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
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
    const consolidatedApps = [...appGroups.values()];

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

    // Get claimed apps
    const { data: claimedApps } = await supabase
      .from('claimed_apps')
      .select('discovered_app_id, status')
      .eq('tenant_id', tenantId);

    const claimedMap = new Map(
      claimedApps?.map(c => [c.discovered_app_id, c.status]) || []
    );

    // Get manual mappings for this tenant
    const { data: manualMappings } = await supabase
      .from('manual_app_mappings')
      .select('*')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`);

    const manualMappingMap = new Map(
      manualMappings?.map(m => [m.discovered_app_name.toLowerCase(), m]) || []
    );

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

    // Upsert new cache entries, then remove stale ones from previous syncs.
    // This avoids a delete-then-insert race where concurrent requests could
    // see an empty cache and both hit the Graph API.
    if (cacheRecords.length > 0) {
      await supabase
        .from('discovered_apps_cache')
        .upsert(cacheRecords, { onConflict: 'tenant_id,discovered_app_id' });
    }

    // Remove entries from previous syncs that are no longer present
    await supabase
      .from('discovered_apps_cache')
      .delete()
      .eq('tenant_id', tenantId)
      .lt('last_synced', now);

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

    const supabase = createServerClient();
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

/**
 * Get access token for the service principal using client credentials flow
 */
async function getServicePrincipalToken(tenantId: string): Promise<string | null> {
  // Return cached token if still valid (with 10-min buffer)
  const cached = tokenCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now() + 10 * 60 * 1000) {
    return cached.token;
  }

  // Deduplicate concurrent token fetches for the same tenant
  const inflight = tokenInflight.get(tenantId);
  if (inflight) return inflight;

  const promise = fetchServicePrincipalToken(tenantId).finally(() => {
    tokenInflight.delete(tenantId);
  });
  tokenInflight.set(tenantId, promise);
  return promise;
}

async function fetchServicePrincipalToken(tenantId: string): Promise<string | null> {
  const clientId = process.env.AZURE_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Service principal token failure: missing AZURE_CLIENT_ID or AZURE_CLIENT_SECRET');
    return null;
  }

  try {
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      }
    );

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text().catch(() => 'unknown error');
      console.error(`Service principal token failure for tenant ${tenantId}: ${tokenResponse.status} - ${errorText}`);
      tokenCache.delete(tenantId);
      return null;
    }

    const tokenData = await tokenResponse.json();
    const token = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 3600;
    tokenCache.set(tenantId, {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    return token;
  } catch (error) {
    console.error('Service principal token error:', error);
    tokenCache.delete(tenantId);
    return null;
  }
}
