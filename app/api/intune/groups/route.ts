/**
 * Intune Groups API Route
 * Searches Entra ID groups for assignment configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import { getEntraIDGroups } from '@/lib/intune-api';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';

export async function GET(request: NextRequest) {
  try {
    // Get search query parameter
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';

    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // MSP tenant resolution and the tenant_consent check both require
    // Supabase. In Supabase-less SQLite installs there is no MSP membership
    // data and no consent table to check - fall back to the token's own
    // tenant and let the service-principal token acquired below prove
    // consent (matches the pattern in unmanaged-apps/route.ts).
    let tenantId = user.tenantId;
    if (isSupabaseConfigured()) {
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

      tenantId = tenantResolution.tenantId;

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
    }

    // Get the service principal token to call Graph API
    const graphToken = await getServicePrincipalToken(tenantId);

    if (!graphToken) {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    // Fetch groups from Graph API using the intune-api helper
    const groups = await getEntraIDGroups(graphToken, search || undefined);

    return NextResponse.json({
      groups,
      count: groups.length,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch groups' },
      { status: 500 }
    );
  }
}
