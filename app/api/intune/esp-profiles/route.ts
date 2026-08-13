/**
 * ESP Profiles API Route
 * Fetches available Enrollment Status Page profiles from the tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClientOrNull } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import { acquireGraphToken } from '@/lib/graph-token';
import { listEspProfiles } from '@/lib/esp-api';

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = getServerClientOrNull();
    if (!supabase) {
      return NextResponse.json({ profiles: [], count: 0 });
    }
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

    let graphToken: string;
    try {
      const tokenResult = await acquireGraphToken(tenantId);
      graphToken = tokenResult.accessToken;
    } catch {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    const profiles = await listEspProfiles(graphToken);

    return NextResponse.json({
      profiles,
      count: profiles.length,
    });
  } catch (err) {
    console.error('[ESP Profiles] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch ESP profiles' },
      { status: 500 }
    );
  }
}
