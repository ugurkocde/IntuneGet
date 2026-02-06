/**
 * Claim App API Route
 * Records when a user claims an unmanaged app for deployment
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { ClaimAppRequest, ClaimedApp } from '@/types/unmanaged';
import type { Database } from '@/types/database';

// Type alias for claimed_apps table row
type ClaimedAppRow = Database['public']['Tables']['claimed_apps']['Row'];
type ClaimedAppInsert = Database['public']['Tables']['claimed_apps']['Insert'];
type ClaimedAppUpdate = Database['public']['Tables']['claimed_apps']['Update'];
type UserProfileInsert = Database['public']['Tables']['user_profiles']['Insert'];

/**
 * Ensure user profile exists in the database
 * This is necessary because claimed_apps has a foreign key to user_profiles
 */
async function ensureUserProfile(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  tenantId: string,
  tokenPayload: Record<string, unknown>
): Promise<void> {
  const email = tokenPayload.preferred_username || tokenPayload.email;
  const name = tokenPayload.name;

  const profileData: UserProfileInsert = {
    id: userId,
    email: typeof email === 'string' ? email : null,
    name: typeof name === 'string' ? name : null,
    intune_tenant_id: tenantId,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('user_profiles').upsert(
    profileData,
    { onConflict: 'id' }
  );

  if (error) {
    // Try insert instead if upsert fails
    const { error: insertError } = await supabase
      .from('user_profiles')
      .insert(profileData);

    if (insertError) {
      throw new Error(`Failed to create user profile: ${insertError.message}`);
    }
  }
}

/**
 * POST - Create a new claim record
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const accessToken = authHeader.slice(7);
    let userId: string;
    let tenantId: string;
    let tokenPayload: Record<string, unknown>;

    try {
      tokenPayload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      userId = (tokenPayload.oid || tokenPayload.sub) as string;
      tenantId = tokenPayload.tid as string;

      if (!userId || !tenantId) {
        return NextResponse.json(
          { error: 'Invalid token: missing identifiers' },
          { status: 401 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid token format' },
        { status: 401 }
      );
    }

    const body: ClaimAppRequest = await request.json();

    if (!body.discoveredAppId || !body.discoveredAppName || !body.wingetPackageId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Ensure user profile exists (required for foreign key constraint)
    await ensureUserProfile(supabase, userId, tenantId, tokenPayload);

    // Check if already claimed
    const { data: existing } = await supabase
      .from('claimed_apps')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('discovered_app_id', body.discoveredAppId)
      .single();

    let claim: ClaimedAppRow | null = null;
    let error: { message: string } | null = null;

    if (existing) {
      // Update existing claim (allow re-claiming)
      const updateData: ClaimedAppUpdate = {
        user_id: userId,
        winget_package_id: body.wingetPackageId,
        device_count_at_claim: body.deviceCount || 0,
        status: 'pending',
        claimed_at: new Date().toISOString(),
      };
      const result = await supabase
        .from('claimed_apps')
        .update(updateData)
        .eq('id', existing.id)
        .select()
        .single();
      claim = result.data;
      error = result.error;
    } else {
      // Create new claim record
      const insertData: ClaimedAppInsert = {
        user_id: userId,
        tenant_id: tenantId,
        discovered_app_id: body.discoveredAppId,
        discovered_app_name: body.discoveredAppName,
        winget_package_id: body.wingetPackageId,
        device_count_at_claim: body.deviceCount || 0,
        status: 'pending',
      };
      const result = await supabase
        .from('claimed_apps')
        .insert(insertData)
        .select()
        .single();
      claim = result.data;
      error = result.error;
    }

    if (error || !claim) {
      return NextResponse.json(
        { error: 'Failed to create claim' },
        { status: 500 }
      );
    }

    const formattedClaim: ClaimedApp = {
      id: claim.id,
      userId: claim.user_id,
      tenantId: claim.tenant_id,
      discoveredAppId: claim.discovered_app_id,
      discoveredAppName: claim.discovered_app_name,
      wingetPackageId: claim.winget_package_id,
      intuneAppId: claim.intune_app_id,
      deviceCountAtClaim: claim.device_count_at_claim,
      claimedAt: claim.claimed_at,
      status: claim.status as ClaimedApp['status'],
    };

    return NextResponse.json({ claim: formattedClaim }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create claim' },
      { status: 500 }
    );
  }
}

/**
 * GET - List claimed apps for the tenant
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

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

    const supabase = createServerClient();

    const { data: claims, error } = await supabase
      .from('claimed_apps')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('claimed_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch claims' },
        { status: 500 }
      );
    }

    const formattedClaims: ClaimedApp[] = (claims || []).map(c => ({
      id: c.id,
      userId: c.user_id,
      tenantId: c.tenant_id,
      discoveredAppId: c.discovered_app_id,
      discoveredAppName: c.discovered_app_name,
      wingetPackageId: c.winget_package_id,
      intuneAppId: c.intune_app_id,
      deviceCountAtClaim: c.device_count_at_claim,
      claimedAt: c.claimed_at,
      status: c.status as ClaimedApp['status'],
    }));

    return NextResponse.json({ claims: formattedClaims });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch claims' },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update claim status (e.g., after deployment)
 */
export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

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

    const body = await request.json();
    const { claimId, status, intuneAppId } = body;

    if (!claimId) {
      return NextResponse.json(
        { error: 'Missing claim ID' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const updates: ClaimedAppUpdate = {};
    if (status) updates.status = status;
    if (intuneAppId) updates.intune_app_id = intuneAppId;

    const { data: claim, error } = await supabase
      .from('claimed_apps')
      .update(updates)
      .eq('id', claimId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error || !claim) {
      return NextResponse.json(
        { error: 'Failed to update claim' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      claim: {
        id: claim.id,
        userId: claim.user_id,
        tenantId: claim.tenant_id,
        discoveredAppId: claim.discovered_app_id,
        discoveredAppName: claim.discovered_app_name,
        wingetPackageId: claim.winget_package_id,
        intuneAppId: claim.intune_app_id,
        deviceCountAtClaim: claim.device_count_at_claim,
        claimedAt: claim.claimed_at,
        status: claim.status,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to update claim' },
      { status: 500 }
    );
  }
}
