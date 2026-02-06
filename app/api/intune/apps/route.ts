/**
 * Intune Apps API Route
 * Lists all Win32 apps from the user's Intune tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { IntuneWin32App } from '@/types/inventory';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

export async function GET(request: NextRequest) {
  try {
    // Get the authorization header (Microsoft access token from MSAL)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Decode the token to get user info
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

    // Get the service principal access token from the database
    const supabase = createServerClient();

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

    // Get the service principal token to call Graph API
    const graphToken = await getServicePrincipalToken(tenantId);

    if (!graphToken) {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    // Fetch Win32 apps from Graph API with pagination support
    // Note: We can't use $select with derived type fields when using isof filter
    // So we fetch all fields and let Graph API return the full win32LobApp objects
    const apps: IntuneWin32App[] = [];

    let nextUrl: string | null = `${GRAPH_API_BASE}/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.win32LobApp')&$orderby=displayName&$top=100`;

    while (nextUrl) {
      const graphResponse: Response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!graphResponse.ok) {
        return NextResponse.json(
          { error: 'Failed to fetch apps from Intune' },
          { status: graphResponse.status }
        );
      }

      const graphData = await graphResponse.json();
      const pageApps: IntuneWin32App[] = graphData.value || [];
      apps.push(...pageApps);

      // Check for next page
      nextUrl = graphData['@odata.nextLink'] || null;
    }

    return NextResponse.json({
      apps,
      count: apps.length,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch Intune apps' },
      { status: 500 }
    );
  }
}

/**
 * Get access token for the service principal using client credentials flow
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
