/**
 * Intune Apps API Route
 * Lists all Win32 apps from the user's Intune tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClientOrNull } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { inventoryPageUrl, toInventoryListApp } from '@/lib/intune/inventory-list';
import type { IntuneWin32App } from '@/types/inventory';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get the service principal access token from the database
    const supabase = getServerClientOrNull();
    const mspTenantId = request.headers.get('X-MSP-Tenant-Id');
    let tenantId = user.tenantId;

    if (supabase) {
      const tenantResolution = await resolveTargetTenantId({
        supabase, userId: user.userId, tokenTenantId: user.tenantId,
        requestedTenantId: mspTenantId,
      });
      if (tenantResolution.errorResponse) return tenantResolution.errorResponse;
      tenantId = tenantResolution.tenantId;

      const { data: consentData, error: consentError } = await supabase
        .from('tenant_consent').select('*').eq('tenant_id', tenantId)
        .eq('is_active', true).single();
      if (consentError || !consentData) {
        return NextResponse.json(
          { error: 'Admin consent not found. Please complete the admin consent flow.' },
          { status: 403 }
        );
      }
    }

    // Get the service principal token to call Graph API
    const graphToken = await getServicePrincipalToken(tenantId);

    if (!graphToken) {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    // The browser progressively accumulates lightweight pages, preserving
    // whole-inventory filtering while showing the first page immediately.
    if (request.nextUrl.searchParams.get('view') === 'list') {
      const response = await fetch(inventoryPageUrl(request.nextUrl.searchParams.get('cursor')), {
        headers: { Authorization: `Bearer ${graphToken}` }, signal: request.signal,
        cache: 'no-store',
      });
      if (!response.ok) return NextResponse.json({ error: 'Failed to fetch apps from Intune' }, { status: response.status });
      const data = await response.json();
      const nextPageToken = data['@odata.nextLink']
        ? new URL(data['@odata.nextLink']).searchParams.get('$skiptoken') : null;
      if (data['@odata.nextLink'] && !nextPageToken) {
        return NextResponse.json({ error: 'Unsupported inventory pagination response' }, { status: 502 });
      }
      const apps = (data.value || []).map(toInventoryListApp);
      return NextResponse.json({ apps, count: apps.length, nextPageToken }, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
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
