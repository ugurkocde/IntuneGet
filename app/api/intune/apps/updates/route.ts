/**
 * Intune Apps Updates API Route
 * Identifies apps with available Winget updates
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { matchAppToWinget } from '@/lib/app-matching';
import { hasUpdate, normalizeVersion } from '@/lib/version-compare';
import type { IntuneWin32App, AppUpdateInfo } from '@/types/inventory';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';
const WINGET_API_BASE = 'https://api.winget.run/v2';

// Rate limiting configuration
const BATCH_SIZE = 5; // Process 5 apps concurrently
const BATCH_DELAY_MS = 500; // Wait 500ms between batches

/**
 * Process items in batches with delays to avoid rate limiting
 */
async function processBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number,
  delayMs: number
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);

    // Add delay between batches (except after the last batch)
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: consentData, error: consentError } = await (supabase as any)
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
      console.error('Graph API error:', graphResponse.status, errorText);
      return NextResponse.json(
        { error: 'Failed to fetch apps from Intune', details: errorText },
        { status: graphResponse.status }
      );
    }

    const graphData = await graphResponse.json();
    const apps: IntuneWin32App[] = graphData.value || [];

    // Match apps and check for updates with rate limiting
    const updates: AppUpdateInfo[] = [];
    const checked: { app: string; wingetId: string | null; result: string }[] = [];

    // Prepare apps with their matches for batch processing
    interface AppCheckTask {
      app: IntuneWin32App;
      match: ReturnType<typeof matchAppToWinget>;
    }

    const tasksToProcess: AppCheckTask[] = [];

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

      tasksToProcess.push({ app, match });
    }

    // Process Winget API calls in batches to avoid rate limiting
    const checkResults = await processBatches(
      tasksToProcess,
      async ({ app, match }) => {
        try {
          // Fetch latest version from Winget API
          const wingetResponse = await fetch(
            `${WINGET_API_BASE}/packages/${encodeURIComponent(match!.wingetId)}`,
            {
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );

          if (!wingetResponse.ok) {
            return {
              app,
              match: match!,
              result: 'Winget package not found' as const,
              latestVersion: null,
            };
          }

          const wingetData = await wingetResponse.json();
          const latestVersion = wingetData.Versions?.[0]?.Version ||
                                wingetData.latestVersion ||
                                null;

          return {
            app,
            match: match!,
            result: latestVersion ? ('success' as const) : ('No version info from Winget' as const),
            latestVersion,
          };
        } catch (error) {
          console.error(`Error checking updates for ${app.displayName}:`, error);
          return {
            app,
            match: match!,
            result: 'Error checking Winget' as const,
            latestVersion: null,
          };
        }
      },
      BATCH_SIZE,
      BATCH_DELAY_MS
    );

    // Process results
    for (const checkResult of checkResults) {
      const { app, match, result, latestVersion } = checkResult;

      if (result !== 'success') {
        checked.push({
          app: app.displayName,
          wingetId: match.wingetId,
          result,
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
  } catch (error) {
    console.error('Updates API error:', error);
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
      const errorText = await tokenResponse.text();
      console.error('Azure AD token request failed:', tokenResponse.status, errorText);
      return null;
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch (error) {
    console.error('Failed to get service principal token:', error);
    return null;
  }
}
