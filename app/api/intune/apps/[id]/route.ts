/**
 * Intune App Details API Route
 * Gets details for a specific Win32 app including assignments
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { IntuneAppWithAssignments, IntuneAppAssignment } from '@/types/inventory';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

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

    // Fetch app details and assignments in parallel
    const [appResponse, assignmentsResponse] = await Promise.all([
      fetch(`${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${id}`, {
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
        },
      }),
      fetch(`${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${id}/assignments`, {
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
        },
      }),
    ]);

    if (!appResponse.ok) {
      if (appResponse.status === 404) {
        return NextResponse.json(
          { error: 'App not found' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to fetch app details' },
        { status: appResponse.status }
      );
    }

    const appData = await appResponse.json();
    let assignments: IntuneAppAssignment[] = [];

    if (assignmentsResponse.ok) {
      const assignmentsData = await assignmentsResponse.json();
      assignments = assignmentsData.value || [];
    }

    const app: IntuneAppWithAssignments = {
      ...appData,
      assignments,
    };

    return NextResponse.json({ app });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch app details' },
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
