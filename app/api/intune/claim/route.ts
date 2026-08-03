/**
 * Claim App API Route
 * Records when a user claims an unmanaged app for deployment
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
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
  userEmail: string | null,
  userName: string | null,
): Promise<void> {
  const profileData: UserProfileInsert = {
    id: userId,
    email: userEmail,
    name: userName,
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
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
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

    // Claim tracking (claimed_apps/user_profiles) has no SQLite equivalent -
    // it's a Supabase-only feature, unlike the discovered-apps scan itself
    // (unmanaged-apps/route.ts), which runs live and cache-less without
    // Supabase. Report unavailable rather than crash; the caller (POST
    // handler in use-unmanaged-apps.ts) already treats a >=500 response here
    // as non-fatal and still adds the app to the cart.
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Claim tracking is not available without Supabase configured.' },
        { status: 503 }
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

    // Ensure user profile exists (required for foreign key constraint)
    await ensureUserProfile(supabase, user.userId, tenantId, user.userEmail, user.userName);

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
        user_id: user.userId,
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
        user_id: user.userId,
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
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Claim tracking has no SQLite equivalent (Supabase-only feature).
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ claims: [] });
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
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
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

    // Claim tracking has no SQLite equivalent (Supabase-only feature).
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Claim tracking is not available without Supabase configured.' },
        { status: 503 }
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
