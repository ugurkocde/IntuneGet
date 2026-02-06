/**
 * MSP Organization API Routes
 * GET - Get user's MSP organization (if any)
 * POST - Create a new MSP organization
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  MspOrganization,
  MspOrganizationStats,
  MspUserMembership,
  GetOrganizationResponse,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
} from '@/types/msp';
import { generateSlug } from '@/types/msp';

// Database row types for type-safe query results
type MspUserMembershipRow = Database['public']['Tables']['msp_user_memberships']['Row'];
type MspOrganizationRow = Database['public']['Tables']['msp_organizations']['Row'];
type MspOrganizationStatsRow = Database['public']['Views']['msp_organization_stats']['Row'];
type MspManagedTenantInsert = Database['public']['Tables']['msp_managed_tenants']['Insert'];
type MspOrganizationInsert = Database['public']['Tables']['msp_organizations']['Insert'];
type MspUserMembershipInsert = Database['public']['Tables']['msp_user_memberships']['Insert'];

// Type for membership with joined organization
interface MembershipWithOrganization extends MspUserMembershipRow {
  msp_organizations: MspOrganizationRow;
}

/**
 * Type-safe table accessor for Supabase operations
 * Casts to any to work around Supabase client overload conflicts
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTable(supabase: SupabaseClient<Database>, table: string): any {
  return supabase.from(table as keyof Database['public']['Tables']);
}

/**
 * GET /api/msp/organization
 * Get the user's MSP organization and stats
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

    const supabase = createServerClient();

    // Check if user has an MSP membership with an active organization
    const membershipResult = await getTable(supabase, 'msp_user_memberships')
      .select('*, msp_organizations!inner(*)')
      .eq('user_id', user.userId)
      .eq('msp_organizations.is_active', true)
      .single();

    const membership = membershipResult.data as MembershipWithOrganization | null;
    const membershipError = membershipResult.error;

    if (membershipError && membershipError.code !== 'PGRST116') {
      return NextResponse.json(
        { error: 'Failed to fetch organization' },
        { status: 500 }
      );
    }

    // If no membership found
    if (!membership) {
      const response: GetOrganizationResponse = {
        organization: null,
        stats: null,
        isMspUser: false,
      };
      return NextResponse.json(response);
    }

    // Get organization stats
    const organization = membership.msp_organizations as MspOrganization;

    const statsResult = await getTable(supabase, 'msp_organization_stats')
      .select('*')
      .eq('organization_id', organization.id)
      .single();

    const stats = statsResult.data as MspOrganizationStatsRow | null;
    const statsError = statsResult.error;

    if (statsError && statsError.code !== 'PGRST116') {
      // Stats fetch error - continue without stats
    }

    const response: GetOrganizationResponse = {
      organization,
      stats: stats as MspOrganizationStats | null,
      isMspUser: true,
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/msp/organization
 * Create a new MSP organization
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

    // Parse request body
    const body: CreateOrganizationRequest = await request.json();
    const { name, slug: providedSlug } = body;

    if (!name || name.trim().length < 2) {
      return NextResponse.json(
        { error: 'Organization name must be at least 2 characters' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Check if user already has an organization
    const existingMembershipResult = await getTable(supabase, 'msp_user_memberships')
      .select('id')
      .eq('user_id', user.userId)
      .single();

    const existingMembership = existingMembershipResult.data as { id: string } | null;

    if (existingMembership) {
      return NextResponse.json(
        { error: 'You already belong to an MSP organization' },
        { status: 400 }
      );
    }

    // Generate or validate slug
    let slug = providedSlug || generateSlug(name.trim());

    // Ensure slug is unique
    const existingOrgResult = await getTable(supabase, 'msp_organizations')
      .select('id')
      .eq('slug', slug)
      .single();

    const existingOrg = existingOrgResult.data as { id: string } | null;

    if (existingOrg) {
      // Append a random suffix to make it unique
      slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
    }

    // Create the organization with typed insert data
    const orgInsertData: MspOrganizationInsert = {
      name: name.trim(),
      slug,
      primary_tenant_id: user.tenantId,
      created_by_user_id: user.userId,
      created_by_email: user.userEmail,
      is_active: true,
    };

    const orgResult = await getTable(supabase, 'msp_organizations')
      .insert(orgInsertData)
      .select()
      .single();

    const organization = orgResult.data as MspOrganizationRow | null;
    const orgError = orgResult.error;

    if (orgError || !organization) {
      return NextResponse.json(
        { error: 'Failed to create organization' },
        { status: 500 }
      );
    }

    // Create the user membership with typed insert data
    const membershipInsertData: MspUserMembershipInsert = {
      msp_organization_id: organization.id,
      user_id: user.userId,
      user_email: user.userEmail,
      user_name: user.userName,
      user_tenant_id: user.tenantId,
    };

    const membershipResult = await getTable(supabase, 'msp_user_memberships')
      .insert(membershipInsertData)
      .select()
      .single();

    const newMembership = membershipResult.data as MspUserMembershipRow | null;
    const membershipCreateError = membershipResult.error;

    if (membershipCreateError || !newMembership) {
      // Try to rollback the organization creation
      await getTable(supabase, 'msp_organizations')
        .delete()
        .eq('id', organization.id);

      return NextResponse.json(
        { error: 'Failed to create organization membership' },
        { status: 500 }
      );
    }

    // Automatically add the MSP's own tenant as a managed tenant with granted consent
    const tenantInsertData: MspManagedTenantInsert = {
      msp_organization_id: organization.id,
      tenant_id: user.tenantId,
      display_name: 'My Organization',
      consent_status: 'granted',
      consent_granted_at: new Date().toISOString(),
      consented_by_email: user.userEmail,
      added_by_user_id: user.userId,
      notes: 'Primary MSP tenant (automatically added)',
      is_active: true,
    };

    const tenantResult = await getTable(supabase, 'msp_managed_tenants')
      .insert(tenantInsertData);

    const tenantError = tenantResult.error;

    if (tenantError) {
      // Rollback: delete membership and organization
      await getTable(supabase, 'msp_user_memberships')
        .delete()
        .eq('id', newMembership.id);
      await getTable(supabase, 'msp_organizations')
        .delete()
        .eq('id', organization.id);

      return NextResponse.json(
        { error: 'Failed to initialize organization. Please try again.' },
        { status: 500 }
      );
    }

    const response: CreateOrganizationResponse = {
      organization: organization as MspOrganization,
      membership: newMembership as MspUserMembership,
    };

    return NextResponse.json(response, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
