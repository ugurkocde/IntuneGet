/**
 * Intune Apps Updates API Route
 * Identifies apps with available Winget updates
 * Uses curated_apps table from Supabase for fast version lookups
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import {
  isValidWingetId,
  matchAppToWinget,
  matchAppToWingetWithDatabase,
} from '@/lib/app-matching';
import { compareVersions, hasUpdate, normalizeVersion } from '@/lib/version-compare';
import { isSelfUpdatingApp } from '@/lib/self-updating-apps';
import { parseAccessToken } from '@/lib/auth-utils';
import { getCatalogSource } from '@/lib/catalog';
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
  // True for explicit provenance (deployment history, IntuneGet description
  // marker, or user-claimed/manual mapping); false for fuzzy name matches.
  isManaged: boolean;
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

interface ClaimedAppMappingRow {
  intune_app_id: string | null;
  discovered_app_name: string;
  winget_package_id: string;
}

interface ManualAppMappingRow {
  discovered_app_name: string;
  winget_package_id: string;
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
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Update checking requires Supabase and is not available on this self-hosted deployment' },
        { status: 503 }
      );
    }

    // Verify admin consent
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
      .eq('user_id', user.userId)
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

    // Build explicit user-link mappings from the Discovered Apps feature.
    // These take precedence over fuzzy matching: if a user explicitly linked
    // an app to a Winget package, use that link with high confidence.
    const claimedWingetByIntuneAppId = new Map<string, string>();
    const claimedWingetByName = new Map<string, string>();
    const { data: claimedRows } = await supabase
      .from('claimed_apps')
      .select('intune_app_id, discovered_app_name, winget_package_id')
      .eq('tenant_id', tenantId);

    if (claimedRows) {
      for (const row of claimedRows as ClaimedAppMappingRow[]) {
        if (!row.winget_package_id) {
          continue;
        }
        if (row.intune_app_id) {
          claimedWingetByIntuneAppId.set(row.intune_app_id, row.winget_package_id);
        }
        if (row.discovered_app_name) {
          claimedWingetByName.set(
            row.discovered_app_name.toLowerCase().trim(),
            row.winget_package_id
          );
        }
      }
    }

    // Manual mappings are keyed by lowercased display name; include tenant
    // mappings and global (tenant_id is null) mappings.
    const manualWingetByName = new Map<string, string>();
    const { data: manualMappingRows } = await supabase
      .from('manual_app_mappings')
      .select('discovered_app_name, winget_package_id')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`);

    if (manualMappingRows) {
      for (const row of manualMappingRows as ManualAppMappingRow[]) {
        if (row.discovered_app_name && row.winget_package_id) {
          manualWingetByName.set(
            row.discovered_app_name.toLowerCase().trim(),
            row.winget_package_id
          );
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
          isManaged: true,
        });
        continue;
      }

      const descriptionWingetId = extractWingetIdFromDescription(app.description);
      if (descriptionWingetId) {
        matchedApps.push({
          app,
          wingetId: descriptionWingetId,
          isManaged: true,
        });
        continue;
      }

      // Explicit user links (claimed apps and manual mappings) take
      // precedence over fuzzy matching.
      const normalizedDisplayName = app.displayName.toLowerCase().trim();
      const explicitWingetId =
        claimedWingetByIntuneAppId.get(app.id) ||
        manualWingetByName.get(normalizedDisplayName) ||
        claimedWingetByName.get(normalizedDisplayName);
      if (explicitWingetId) {
        matchedApps.push({
          app,
          wingetId: explicitWingetId,
          isManaged: true,
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
        isManaged: false,
      });
    }

    // Batch lookup all Winget versions from curated_apps table (single DB query)
    const versionMap = new Map<string, string>();
    const wingetIdsToLookup = Array.from(new Set(matchedApps.map((m) => m.wingetId)));

    if (wingetIdsToLookup.length > 0) {
      const cachedPackages = await getCatalogSource().getAppsByWingetIds(wingetIdsToLookup);

      for (const pkg of cachedPackages as CuratedPackageRow[]) {
        if (pkg.latest_version) {
          versionMap.set(pkg.winget_id, pkg.latest_version);
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
      // Self-updating apps (e.g. Microsoft 365 Apps via Click-to-Run) must
      // never be offered as updates - the installed product updates itself
      // and the winget version only tracks the setup bootstrapper
      if (isSelfUpdatingApp(wingetId)) {
        for (const candidate of candidates) {
          checked.push({
            app: candidate.app.displayName,
            wingetId,
            result: 'Self-updating app, excluded from updates',
          });
        }
        continue;
      }

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

      // If IntuneGet has explicit provenance over ANY app object for this
      // winget ID, treat the whole group as managed -- an unmanaged duplicate
      // object with a higher version must not mask a package we deployed.
      const groupIsManaged = candidates.some((candidate) => candidate.isManaged);

      if (updateAvailable) {
        updates.push({
          intuneApp: newestCandidate.app,
          currentVersion: currentVersion !== '0.0.0' ? currentVersion : 'Unknown',
          latestVersion: latestVersion,
          wingetId,
          hasUpdate: true,
          isManaged: groupIsManaged,
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
