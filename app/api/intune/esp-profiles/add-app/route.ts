/**
 * ESP Profile Add App API Route
 * Adds an Intune app to one or more ESP profiles
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClientOrNull } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import { acquireGraphToken } from '@/lib/graph-token';
import { addAppToEspProfile } from '@/lib/esp-api';
import type { AddToEspResult } from '@/types/esp';

interface AddAppRequestBody {
  intuneAppId: string;
  espProfileIds: string[];
  espProfileNames?: Record<string, string>;
}

export async function POST(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body: AddAppRequestBody = await request.json();

    if (!body.intuneAppId || typeof body.intuneAppId !== 'string') {
      return NextResponse.json(
        { error: 'intuneAppId is required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.espProfileIds) || body.espProfileIds.length === 0) {
      return NextResponse.json(
        { error: 'espProfileIds must be a non-empty array' },
        { status: 400 }
      );
    }

    if (!body.espProfileIds.every((id) => typeof id === 'string' && id.trim().length > 0)) {
      return NextResponse.json(
        { error: 'espProfileIds must contain non-empty strings' },
        { status: 400 }
      );
    }

    const supabase = getServerClientOrNull();
    if (!supabase) {
      return NextResponse.json(
        { error: 'ESP profile updates require Supabase server configuration' },
        { status: 503 }
      );
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

    const profileNames = body.espProfileNames || {};
    const results: AddToEspResult[] = [];

    for (const profileId of body.espProfileIds) {
      try {
        const { alreadyAdded } = await addAppToEspProfile(
          graphToken,
          profileId,
          body.intuneAppId
        );
        results.push({
          profileId,
          profileName: profileNames[profileId] || profileId,
          success: true,
          alreadyAdded,
        });
      } catch (err) {
        results.push({
          profileId,
          profileName: profileNames[profileId] || profileId,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json(
      { error: 'Failed to add app to ESP profiles' },
      { status: 500 }
    );
  }
}
