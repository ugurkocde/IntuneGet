/**
 * Intune Apps Updates API Route
 * Identifies apps with available Winget updates
 * Uses curated_apps table from Supabase for fast version lookups
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import {
  isValidWingetId,
  matchAppToWinget,
  matchAppToWingetWithDatabase,
} from '@/lib/app-matching';
import { compareVersions, hasUpdate, normalizeVersion } from '@/lib/version-compare';
import type { IntuneWin32App, AppUpdateInfo } from '@/types/inventory';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

interface CheckedResult {
  app: string;
  wingetId: string | null;
  result: string;
}

interface MatchedApp {
  app: IntuneWin32App;
  wingetId: string;
}

interface CuratedPackageRow {
  winget_id: string;
  latest_version: string | null;
}

interface UploadHistoryMappingRow {
  intune_app_id: string;
  winget_id: string;
  version: string | null;
}

function extractWingetIdFromDescription(description: string | null): string | null {
  if (!description) {
    return null;
  }

  const match = description.match(
    /Winget:\s*([A-Za-z0-9]+\.[A-Za-z0-9]+(?:\.[A-Za-z0-9-]+)*)/i
  );

  if (!match) {
    return null;
  }

  const candidate = match[1].trim();
  return isValidWingetId(candidate) ? candidate : null;
}

// Extend timeout for Vercel (Pro plan: up to 60s)
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    // Get the authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Decode the token
    const accessToken = authHeader.slice(7);
    let userId: string;
    let tenantId: string;

    try {
      const tokenPayload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      userId = tokenPayload.oid || tokenPayload.sub;
      tenantId = tokenPayload.tid;

      if (!userId) {
        return NextResponse.json(
          { error: 'Invalid token: missing user identifier' },
          { status: 401 }
        );
      }

      if (!tenantId) {
        return NextResponse.json(
          { error: 'Invalid token: missing tenant identifier' },
          { status: 401 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid token format' },
        { status: 401 }
      );
    }

    // Verify admin consent
    const supabase = createServerClient();
    const mspTenantId = request.headers.get('X-MSP-Tenant-Id');

    const tenantResolution = await resolveTargetTenantId({
      supabase,
      userId,
      tokenTenantId: tenantId,
      requestedTenantId: mspTenantId,
    });

    if (tenantResolution.errorResponse) {
      return tenantResolution.errorResponse;
    }

    tenantId = tenantResolution.tenantId;

    const { data: consentData, error: consentError } = await supabase
      .from('tenant_consent')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (consentError || !consentData) {
      return NextResponse.json(
        { error: 'Admin consent not found' },
        { status: 403 }
      );
    }

    // Get service principal token
    const graphToken = await getServicePrincipalToken(tenantId);

    if (!graphToken) {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    // Fetch Win32 apps from Intune using isof filter with pagination
    // Note: We can't use $select with derived type fields (like displayVersion) when using type filters
    const apps: IntuneWin32App[] = [];
    let nextUrl: string | null = `${GRAPH_API_BASE}/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.win32LobApp')&$top=100`;

    while (nextUrl) {
      const graphResponse: Response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!graphResponse.ok) {
        const errorText = await graphResponse.text();
        return NextResponse.json(
          { error: 'Failed to fetch apps from Intune', details: errorText },
          { status: graphResponse.status }
        );
      }

      const graphData = await graphResponse.json();
      const pageApps: IntuneWin32App[] = graphData.value || [];
      apps.push(...pageApps);

      nextUrl = graphData['@odata.nextLink'] || null;
    }

    const liveIntuneAppIds = new Set(apps.map((a) => a.id));

    // Build explicit app-id to winget-id mappings from deployment history.
    const uploadHistoryWingetMap = new Map<string, string>();
    const uploadHistoryVersionMap = new Map<string, string>();
    const { data: tenantHistoryRows } = await supabase
      .from('upload_history')
      .select('intune_app_id, winget_id, version')
      .eq('user_id', userId)
      .eq('intune_tenant_id', tenantId);

    if (tenantHistoryRows) {
      for (const row of tenantHistoryRows as UploadHistoryMappingRow[]) {
        if (row.intune_app_id && row.winget_id) {
          uploadHistoryWingetMap.set(row.intune_app_id, row.winget_id);
        }
        if (row.intune_app_id && row.version && liveIntuneAppIds.has(row.intune_app_id)) {
          uploadHistoryVersionMap.set(row.intune_app_id, row.version);
        }
      }
    }

    // Match apps to Winget IDs
    const updates: AppUpdateInfo[] = [];
    const checked: CheckedResult[] = [];
    const matchedApps: MatchedApp[] = [];

    for (const app of apps) {
      const historyWingetId = uploadHistoryWingetMap.get(app.id);
      if (historyWingetId) {
        matchedApps.push({
          app,
          wingetId: historyWingetId,
        });
        continue;
      }

      const descriptionWingetId = extractWingetIdFromDescription(app.description);
      if (descriptionWingetId) {
        matchedApps.push({
          app,
          wingetId: descriptionWingetId,
        });
        continue;
      }

      let match = matchAppToWinget(app);

      if (!match || match.confidence === 'low') {
        match = await matchAppToWingetWithDatabase(app, supabase);
      }

      if (!match) {
        checked.push({
          app: app.displayName,
          wingetId: null,
          result: 'No match found',
        });
        continue;
      }

      if (match.confidence === 'low') {
        checked.push({
          app: app.displayName,
          wingetId: match.wingetId,
          result: 'Low confidence match - skipped',
        });
        continue;
      }

      matchedApps.push({
        app,
        wingetId: match.wingetId,
      });
    }

    // Batch lookup all Winget versions from curated_apps table (single DB query)
    const versionMap = new Map<string, string>();
    const wingetIdsToLookup = Array.from(new Set(matchedApps.map((m) => m.wingetId)));

    if (wingetIdsToLookup.length > 0) {
      const { data: cachedPackages, error: cacheError } = await supabase
        .from('curated_apps')
        .select('winget_id, latest_version')
        .in('winget_id', wingetIdsToLookup);

      if (!cacheError && cachedPackages) {
        for (const pkg of cachedPackages as CuratedPackageRow[]) {
          if (pkg.latest_version) {
            versionMap.set(pkg.winget_id, pkg.latest_version);
          }
        }
      }
    }

    // Compute the effective version for an app by taking the MAX of its
    // displayVersion and the version recorded in upload_history. This prevents
    // false update detection when Intune's displayVersion lags behind the
    // actually deployed version (propagation delay) or is null/empty.
    function getEffectiveVersion(app: IntuneWin32App): string {
      const displayVer = normalizeVersion(app.displayVersion);
      const historyVer = normalizeVersion(uploadHistoryVersionMap.get(app.id));
      return compareVersions(historyVer, displayVer) > 0 ? historyVer : displayVer;
    }

    // Group by Winget ID and compare using the newest tenant app object.
    // This prevents older Intune objects from suppressing update detection.
    const appsByWinget = new Map<string, MatchedApp[]>();
    for (const matched of matchedApps) {
      if (!appsByWinget.has(matched.wingetId)) {
        appsByWinget.set(matched.wingetId, []);
      }
      appsByWinget.get(matched.wingetId)!.push(matched);
    }

    for (const [wingetId, candidates] of appsByWinget.entries()) {
      const latestVersion = versionMap.get(wingetId);

      if (!latestVersion) {
        for (const candidate of candidates) {
          checked.push({
            app: candidate.app.displayName,
            wingetId,
            result: 'Package not in cache',
          });
        }
        continue;
      }

      const newestCandidate = candidates.reduce((currentNewest, candidate) => {
        const currentNewestVersion = getEffectiveVersion(currentNewest.app);
        const candidateVersion = getEffectiveVersion(candidate.app);
        const comparison = compareVersions(candidateVersion, currentNewestVersion);

        if (comparison > 0) {
          return candidate;
        }

        if (comparison === 0) {
          const currentModified = new Date(currentNewest.app.lastModifiedDateTime).getTime();
          const candidateModified = new Date(candidate.app.lastModifiedDateTime).getTime();
          if (candidateModified > currentModified) {
            return candidate;
          }
        }

        return currentNewest;
      });

      const currentVersion = getEffectiveVersion(newestCandidate.app);
      const normalizedLatest = normalizeVersion(latestVersion);
      const updateAvailable = hasUpdate(currentVersion, normalizedLatest);

      if (updateAvailable) {
        updates.push({
          intuneApp: newestCandidate.app,
          currentVersion: currentVersion !== '0.0.0' ? currentVersion : 'Unknown',
          latestVersion: latestVersion,
          wingetId,
          hasUpdate: true,
        });
      } else {
        // no-op; tracked in checked entries below
      }

      for (const candidate of candidates) {
        if (candidate.app.id === newestCandidate.app.id) {
          checked.push({
            app: candidate.app.displayName,
            wingetId,
            result: updateAvailable
              ? `Update available (newest tenant app): ${currentVersion} -> ${normalizedLatest}`
              : 'Up to date (newest tenant app)',
          });
          continue;
        }

        checked.push({
          app: candidate.app.displayName,
          wingetId,
          result: `Older tenant app object (${getEffectiveVersion(candidate.app)}) - compared using newest ${currentVersion}`,
        });
      }
    }

    return NextResponse.json({
      updates,
      updateCount: updates.length,
      totalApps: apps.length,
      checkedApps: checked,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to check for updates' },
      { status: 500 }
    );
  }
}

/**
 * Get access token for the service principal
 */
async function getServicePrincipalToken(tenantId: string): Promise<string | null> {
  const clientId = process.env.AZURE_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
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
      return null;
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch {
    return null;
  }
}
