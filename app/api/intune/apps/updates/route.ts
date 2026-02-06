/**
 * Intune Apps Updates API Route
 * Identifies apps with available Winget updates
 * Uses curated_apps table from Supabase for fast version lookups
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { matchAppToWinget } from '@/lib/app-matching';
import { hasUpdate, normalizeVersion } from '@/lib/version-compare';
import type { IntuneWin32App, AppUpdateInfo } from '@/types/inventory';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

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
    let tenantId: string;

    try {
      const tokenPayload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      tenantId = tokenPayload.tid;

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

    // Fetch Win32 apps from Intune using isof filter
    // Note: We can't use $select with derived type fields (like displayVersion) when using type filters
    const graphResponse = await fetch(
      `${GRAPH_API_BASE}/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.win32LobApp')`,
      {
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!graphResponse.ok) {
      const errorText = await graphResponse.text();
      return NextResponse.json(
        { error: 'Failed to fetch apps from Intune', details: errorText },
        { status: graphResponse.status }
      );
    }

    const graphData = await graphResponse.json();
    const apps: IntuneWin32App[] = graphData.value || [];

    // Match apps to Winget IDs
    const updates: AppUpdateInfo[] = [];
    const checked: { app: string; wingetId: string | null; result: string }[] = [];

    const appsToCheck: { app: IntuneWin32App; match: NonNullable<ReturnType<typeof matchAppToWinget>> }[] = [];
    const wingetIdsToLookup: string[] = [];

    for (const app of apps) {
      const match = matchAppToWinget(app);

      if (!match) {
        checked.push({
          app: app.displayName,
          wingetId: null,
          result: 'No match found',
        });
        continue;
      }

      // Only check high and medium confidence matches
      if (match.confidence === 'low') {
        checked.push({
          app: app.displayName,
          wingetId: match.wingetId,
          result: 'Low confidence match - skipped',
        });
        continue;
      }

      appsToCheck.push({ app, match });
      wingetIdsToLookup.push(match.wingetId);
    }

    // Batch lookup all Winget versions from curated_apps table (single DB query)
    const versionMap = new Map<string, string>();

    if (wingetIdsToLookup.length > 0) {
      const { data: cachedPackages, error: cacheError } = await supabase
        .from('curated_apps')
        .select('winget_id, latest_version')
        .in('winget_id', wingetIdsToLookup);

      if (!cacheError && cachedPackages) {
        for (const pkg of cachedPackages) {
          if (pkg.latest_version) {
            versionMap.set(pkg.winget_id, pkg.latest_version);
          }
        }
      }
    }

    // Process results using cached data
    for (const { app, match } of appsToCheck) {
      const latestVersion = versionMap.get(match.wingetId);

      if (!latestVersion) {
        checked.push({
          app: app.displayName,
          wingetId: match.wingetId,
          result: 'Package not in cache',
        });
        continue;
      }

      const currentVersion = normalizeVersion(app.displayVersion);
      const normalizedLatest = normalizeVersion(latestVersion);

      const updateAvailable = hasUpdate(currentVersion, normalizedLatest);

      if (updateAvailable) {
        updates.push({
          intuneApp: app,
          currentVersion: app.displayVersion || 'Unknown',
          latestVersion: latestVersion,
          wingetId: match.wingetId,
          hasUpdate: true,
        });

        checked.push({
          app: app.displayName,
          wingetId: match.wingetId,
          result: `Update available: ${currentVersion} -> ${normalizedLatest}`,
        });
      } else {
        checked.push({
          app: app.displayName,
          wingetId: match.wingetId,
          result: 'Up to date',
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
