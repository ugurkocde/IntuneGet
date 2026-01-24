/**
 * MSP Organization API Routes
 * GET - Get user's MSP organization (if any)
 * POST - Create a new MSP organization
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import type {
  MspOrganization,
  MspOrganizationStats,
  MspUserMembership,
  GetOrganizationResponse,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
} from '@/types/msp';
import { generateSlug } from '@/types/msp';

/**
 * GET /api/msp/organization
 * Get the user's MSP organization and stats
 */
export async function GET(request: NextRequest) {
  try {
    const user = parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // Check if user has an MSP membership with an active organization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: membership, error: membershipError } = await (supabase as any)
      .from('msp_user_memberships')
      .select('*, msp_organizations!inner(*)')
      .eq('user_id', user.userId)
      .eq('msp_organizations.is_active', true)
      .single();

    if (membershipError && membershipError.code !== 'PGRST116') {
      console.error('Error fetching membership:', membershipError);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stats, error: statsError } = await (supabase as any)
      .from('msp_organization_stats')
      .select('*')
      .eq('organization_id', organization.id)
      .single();

    if (statsError && statsError.code !== 'PGRST116') {
      console.error('Error fetching stats:', statsError);
    }

    const response: GetOrganizationResponse = {
      organization,
      stats: stats as MspOrganizationStats | null,
      isMspUser: true,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('MSP organization GET error:', error);
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
    const user = parseAccessToken(request.headers.get('Authorization'));
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingMembership } = await (supabase as any)
      .from('msp_user_memberships')
      .select('id')
      .eq('user_id', user.userId)
      .single();

    if (existingMembership) {
      return NextResponse.json(
        { error: 'You already belong to an MSP organization' },
        { status: 400 }
      );
    }

    // Generate or validate slug
    let slug = providedSlug || generateSlug(name.trim());

    // Ensure slug is unique
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingOrg } = await (supabase as any)
      .from('msp_organizations')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existingOrg) {
      // Append a random suffix to make it unique
      slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
    }

    // Create the organization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: organization, error: orgError } = await (supabase as any)
      .from('msp_organizations')
      .insert({
        name: name.trim(),
        slug,
        primary_tenant_id: user.tenantId,
        created_by_user_id: user.userId,
        created_by_email: user.userEmail,
        is_active: true,
      })
      .select()
      .single();

    if (orgError) {
      console.error('Error creating organization:', orgError);
      return NextResponse.json(
        { error: 'Failed to create organization' },
        { status: 500 }
      );
    }

    // Create the user membership
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: membership, error: membershipError } = await (supabase as any)
      .from('msp_user_memberships')
      .insert({
        msp_organization_id: organization.id,
        user_id: user.userId,
        user_email: user.userEmail,
        user_name: user.userName,
        user_tenant_id: user.tenantId,
      })
      .select()
      .single();

    if (membershipError) {
      console.error('Error creating membership:', membershipError);
      // Try to rollback the organization creation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('msp_organizations')
        .delete()
        .eq('id', organization.id);

      return NextResponse.json(
        { error: 'Failed to create organization membership' },
        { status: 500 }
      );
    }

    // Automatically add the MSP's own tenant as a managed tenant with granted consent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: tenantError } = await (supabase as any)
      .from('msp_managed_tenants')
      .insert({
        msp_organization_id: organization.id,
        tenant_id: user.tenantId,
        display_name: 'My Organization',
        consent_status: 'granted',
        consent_granted_at: new Date().toISOString(),
        consented_by_email: user.userEmail,
        added_by_user_id: user.userId,
        notes: 'Primary MSP tenant (automatically added)',
        is_active: true,
      });

    if (tenantError) {
      console.error('Error creating primary tenant record:', tenantError);
      // Rollback: delete membership and organization
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('msp_user_memberships')
        .delete()
        .eq('id', membership.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('msp_organizations')
        .delete()
        .eq('id', organization.id);

      return NextResponse.json(
        { error: 'Failed to initialize organization. Please try again.' },
        { status: 500 }
      );
    }

    const response: CreateOrganizationResponse = {
      organization: organization as MspOrganization,
      membership: membership as MspUserMembership,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('MSP organization POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
