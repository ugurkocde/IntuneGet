/**
 * Intune Assignment Filters API Route
 * Fetches available Intune assignment filters for deployment configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import { getAssignmentFilters } from '@/lib/intune-api';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';

export async function GET(request: NextRequest) {
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

    const graphToken = await getServicePrincipalToken(tenantId);
    if (!graphToken) {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    const filters = await getAssignmentFilters(graphToken);

    return NextResponse.json({
      filters,
      count: filters.length,
    });
  } catch (error) {
    // Reading assignment filters requires DeviceManagementConfiguration.Read.All,
    // which is separate from the other Intune permissions IntuneGet uses. A 403
    // here almost always means that scope was never consented, so surface an
    // actionable message instead of a generic failure (which the UI would
    // otherwise render as "no filters available").
    const status = (error as { status?: number })?.status;
    if (status === 403) {
      return NextResponse.json(
        {
          error:
            'Missing required permission: DeviceManagementConfiguration.Read.All. Add this permission to the IntuneGet app registration and grant admin consent to load assignment filters.',
          permissionRequired: 'DeviceManagementConfiguration.Read.All',
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch Intune assignment filters' },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}
