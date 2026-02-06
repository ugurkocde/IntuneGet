/**
 * MSP Tenants API Routes
 * GET - List managed tenants for user's MSP organization
 * POST - Add a new customer tenant (returns consent URL)
 * DELETE - Remove a managed tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getMspCustomerConsentUrl } from '@/lib/msal-config';
import { parseAccessToken, signConsentState, getBaseUrl } from '@/lib/auth-utils';
import type {
  MspManagedTenant,
  MspManagedTenantWithStats,
  GetTenantsResponse,
  AddTenantRequest,
  AddTenantResponse,
} from '@/types/msp';

/**
 * Type for the user membership query result with joined organization
 */
interface MembershipWithOrg {
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
    .single();

  return (membership as MembershipWithOrg | null)?.msp_organization_id || null;
}

/**
 * GET /api/msp/tenants
 * List all managed tenants for the user's MSP organization
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

    const mspOrgId = await getUserMspOrgId(user.userId);
    if (!mspOrgId) {
      return NextResponse.json(
        { error: 'Not a member of any MSP organization' },
        { status: 403 }
      );
    }

    const supabase = createServerClient();

    // Get all managed tenants for this MSP
    const { data: tenants, error: tenantsError } = await supabase
      .from('msp_managed_tenants')
      .select('*')
      .eq('msp_organization_id', mspOrgId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (tenantsError) {
      return NextResponse.json(
        { error: 'Failed to fetch tenants' },
        { status: 500 }
      );
    }

    // Collect all tenant IDs for batch query
    const tenantIds = (tenants || [])
      .filter((t: MspManagedTenant) => t.tenant_id)
      .map((t: MspManagedTenant) => t.tenant_id);

    // Fetch job stats for all tenants in a single query
    type JobRow = { tenant_id: string | null; status: string; created_at: string };
    let jobsByTenant: Record<string, JobRow[]> = {};

    if (tenantIds.length > 0) {
      const { data: allJobs } = await supabase
        .from('packaging_jobs')
        .select('tenant_id, status, created_at')
        .in('tenant_id', tenantIds)
        .order('created_at', { ascending: false });

      // Group jobs by tenant ID (skip jobs without tenant_id)
      jobsByTenant = (allJobs || []).reduce((acc: Record<string, JobRow[]>, job) => {
        if (job.tenant_id && !acc[job.tenant_id]) {
          acc[job.tenant_id] = [];
        }
        if (job.tenant_id) {
          acc[job.tenant_id].push(job);
        }
        return acc;
      }, {});
    }

    // Enrich tenants with job stats
    const tenantsWithStats: MspManagedTenantWithStats[] = (tenants || []).map((tenant: MspManagedTenant) => {
      if (!tenant.tenant_id) {
        return {
          ...tenant,
          total_jobs: 0,
          completed_jobs: 0,
          failed_jobs: 0,
          last_job_at: null,
        };
      }

      const jobList = jobsByTenant[tenant.tenant_id] || [];
      const completedJobs = jobList.filter((j) => j.status === 'completed' || j.status === 'deployed').length;
      const failedJobs = jobList.filter((j) => j.status === 'failed').length;
      const lastJob = jobList[0];

      return {
        ...tenant,
        total_jobs: jobList.length,
        completed_jobs: completedJobs,
        failed_jobs: failedJobs,
        last_job_at: lastJob?.created_at || null,
      };
    });

    const response: GetTenantsResponse = {
      tenants: tenantsWithStats,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/msp/tenants
 * Add a new customer tenant (creates pending record, returns consent URL)
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

    const mspOrgId = await getUserMspOrgId(user.userId);
    if (!mspOrgId) {
      return NextResponse.json(
        { error: 'Not a member of any MSP organization' },
        { status: 403 }
      );
    }

    // Parse request body
    const body: AddTenantRequest = await request.json();
    const { display_name, notes } = body;

    if (!display_name || display_name.trim().length < 2) {
      return NextResponse.json(
        { error: 'Display name must be at least 2 characters' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Create a pending tenant record
    const { data: tenant, error: insertError } = await supabase
      .from('msp_managed_tenants')
      .insert({
        msp_organization_id: mspOrgId,
        display_name: display_name.trim(),
        consent_status: 'pending',
        added_by_user_id: user.userId,
        notes: notes?.trim() || null,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: 'Failed to create tenant record' },
        { status: 500 }
      );
    }

    // Generate the consent URL with signed state for security
    let consentUrl: string;
    try {
      const baseUrl = getBaseUrl();
      const signedState = signConsentState(mspOrgId, tenant.id);
      consentUrl = getMspCustomerConsentUrl(mspOrgId, tenant.id, baseUrl, signedState);
    } catch (signError) {
      // The tenant was created but we couldn't generate the consent URL
      // Return 500 so the frontend treats this as an error, not a success
      return NextResponse.json(
        {
          error: 'Failed to generate consent URL',
          message: 'The tenant was created but the consent URL could not be generated. Please use the "Get Consent URL" option from the tenant menu to retrieve it.',
          tenant: tenant as MspManagedTenant,
        },
        { status: 500 }
      );
    }

    const response: AddTenantResponse = {
      tenant: tenant as MspManagedTenant,
      consentUrl,
    };

    return NextResponse.json(response, { status: 201 });
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

/**
 * DELETE /api/msp/tenants
 * Remove a managed tenant (soft delete)
 */
export async function DELETE(request: NextRequest) {
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

    // Get tenant record ID from query params
    const { searchParams } = new URL(request.url);
    const tenantRecordId = searchParams.get('id');

    if (!tenantRecordId) {
      return NextResponse.json(
        { error: 'Tenant record ID is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Verify the tenant belongs to this MSP organization
    const { data: tenant } = await supabase
      .from('msp_managed_tenants')
      .select('id, msp_organization_id, tenant_id')
      .eq('id', tenantRecordId)
      .single();

    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      );
    }

    if (tenant.msp_organization_id !== mspOrgId) {
      return NextResponse.json(
        { error: 'Unauthorized to remove this tenant' },
        { status: 403 }
      );
    }

    // Get MSP org info to check if this is the primary tenant
    const { data: mspOrg } = await supabase
      .from('msp_organizations')
      .select('primary_tenant_id')
      .eq('id', mspOrgId)
      .single();

    // Don't allow removing the primary MSP tenant
    if (mspOrg && tenant.tenant_id === mspOrg.primary_tenant_id) {
      return NextResponse.json(
        { error: 'Cannot remove your primary MSP tenant' },
        { status: 400 }
      );
    }

    // Soft delete the tenant record
    const { error: updateError } = await supabase
      .from('msp_managed_tenants')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tenantRecordId);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to remove tenant' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
