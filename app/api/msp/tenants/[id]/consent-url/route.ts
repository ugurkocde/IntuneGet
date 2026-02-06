/**
 * MSP Tenant Consent URL API Route
 * POST - Generate a new consent URL for an existing tenant record
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getMspCustomerConsentUrl } from '@/lib/msal-config';
import { parseAccessToken, signConsentState, getBaseUrl } from '@/lib/auth-utils';
import type { MspManagedTenant, ConsentStatus } from '@/types/msp';

/**
 * Type for the membership query result with joined organization
 */
interface MspUserMembershipWithOrg {
  msp_organization_id: string;
  msp_organizations: {
    is_active: boolean;
  };
}

/**
 * Get the user's MSP organization ID (only for active organizations)
 */
async function getUserMspOrgId(userId: string): Promise<string | null> {
  const supabase = createServerClient();

  const { data: membership } = await supabase
    .from('msp_user_memberships')
    .select('msp_organization_id, msp_organizations!inner(is_active)')
    .eq('user_id', userId)
    .eq('msp_organizations.is_active', true)
    .single<MspUserMembershipWithOrg>();

  return membership?.msp_organization_id || null;
}

// Allowed consent statuses for regenerating consent URL
const ALLOWED_STATUSES: ConsentStatus[] = ['pending', 'consent_incomplete'];

/**
 * POST /api/msp/tenants/[id]/consent-url
 * Generate a new consent URL for an existing tenant record
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const mspOrgId = await getUserMspOrgId(user.userId);
    if (!mspOrgId) {
      return NextResponse.json(
        { error: 'Not a member of any MSP organization' },
        { status: 403 }
      );
    }

    const { id: tenantRecordId } = await params;

    if (!tenantRecordId) {
      return NextResponse.json(
        { error: 'Tenant record ID is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Verify the tenant exists and belongs to this MSP organization
    const { data: tenant, error: tenantError } = await supabase
      .from('msp_managed_tenants')
      .select('*')
      .eq('id', tenantRecordId)
      .eq('is_active', true)
      .single();

    if (tenantError || !tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      );
    }

    const typedTenant: MspManagedTenant = tenant;

    if (typedTenant.msp_organization_id !== mspOrgId) {
      return NextResponse.json(
        { error: 'Unauthorized to access this tenant' },
        { status: 403 }
      );
    }

    // Only allow generating consent URL for pending or consent_incomplete tenants
    if (!ALLOWED_STATUSES.includes(typedTenant.consent_status)) {
      return NextResponse.json(
        {
          error: 'Cannot generate consent URL for this tenant',
          message: typedTenant.consent_status === 'granted'
            ? 'This tenant has already granted consent'
            : 'This tenant has revoked consent. Please remove and re-add the tenant.'
        },
        { status: 400 }
      );
    }

    // Generate the consent URL with signed state for security
    const baseUrl = getBaseUrl();
    const signedState = signConsentState(mspOrgId, tenantRecordId);
    const consentUrl = getMspCustomerConsentUrl(mspOrgId, tenantRecordId, baseUrl, signedState);

    return NextResponse.json({
      consentUrl,
      tenant: typedTenant,
    });
  } catch (error) {
    // Check if it's a state signing error
    if (error instanceof Error && error.message.includes('MSP_STATE_SECRET')) {
      return NextResponse.json(
        {
          error: 'Configuration error',
          message: 'Server is not properly configured for MSP consent. Please contact support.'
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
