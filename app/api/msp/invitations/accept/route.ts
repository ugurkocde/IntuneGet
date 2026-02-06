/**
 * MSP Invitation Accept API Route
 * POST - Accept an invitation and join the organization
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { invitationTokenSchema, validateMspInput } from '@/lib/validators/msp';
import {
  applyRateLimit,
  getIpKey,
  STRICT_RATE_LIMIT,
} from '@/lib/rate-limit';
import { logMemberJoined } from '@/lib/audit-logger';
import { notifyMemberJoined } from '@/lib/notification-service';
import type { Database } from '@/types/database';

// Type for invitation with joined organization data
type MspInvitationRow = Database['public']['Tables']['msp_invitations']['Row'];
type MspOrganizationRow = Database['public']['Tables']['msp_organizations']['Row'];

interface InvitationWithOrganization extends MspInvitationRow {
  msp_organizations: MspOrganizationRow;
}

interface InvitationWithOrgName extends Pick<MspInvitationRow, 'email' | 'role' | 'expires_at' | 'accepted_at'> {
  msp_organizations: { name: string } | null;
}

/**
 * POST /api/msp/invitations/accept
 * Accept an invitation using the token
 */
export async function POST(request: NextRequest) {
  try {
    // Strict rate limiting for invitation acceptance (security measure)
    const rateLimitResponse = await applyRateLimit(getIpKey(request), STRICT_RATE_LIMIT);
    if (rateLimitResponse) return rateLimitResponse;

    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in with Microsoft.' },
        { status: 401 }
      );
    }

    // Validate input
    const body = await request.json();
    const validation = validateMspInput(invitationTokenSchema, body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { token } = validation.data;

    const supabase = createServerClient();

    // Find the invitation
    const { data: invitationData, error: invitationError } = await supabase
      .from('msp_invitations')
      .select('*, msp_organizations!inner(*)')
      .eq('token', token)
      .is('accepted_at', null)
      .single();

    // Cast to proper type since Supabase types don't know about the relationship
    const invitation = invitationData as unknown as InvitationWithOrganization | null;

    if (invitationError || !invitation) {
      return NextResponse.json(
        { error: 'Invalid or already used invitation' },
        { status: 400 }
      );
    }

    // Check if invitation has expired
    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'This invitation has expired' },
        { status: 400 }
      );
    }

    // Verify email matches (case-insensitive)
    if (user.userEmail.toLowerCase() !== invitation.email.toLowerCase()) {
      return NextResponse.json(
        {
          error: 'Email mismatch',
          message: `This invitation was sent to ${invitation.email}. Please sign in with that account.`,
        },
        { status: 403 }
      );
    }

    const organization = invitation.msp_organizations;

    // Verify tenant matches organization's primary tenant
    if (user.tenantId !== organization.primary_tenant_id) {
      return NextResponse.json(
        {
          error: 'Organization mismatch',
          message: 'You must use an account from the organization\'s tenant. Please contact the person who invited you.',
        },
        { status: 403 }
      );
    }

    // Check if user is already a member of any organization
    const { data: existingMembership } = await supabase
      .from('msp_user_memberships')
      .select('id, msp_organization_id')
      .eq('user_id', user.userId)
      .single();

    if (existingMembership) {
      if (existingMembership.msp_organization_id === invitation.organization_id) {
        return NextResponse.json(
          { error: 'You are already a member of this organization' },
          { status: 409 }
        );
      } else {
        return NextResponse.json(
          { error: 'You already belong to another MSP organization' },
          { status: 409 }
        );
      }
    }

    // Add user to organization
    const { data: membership, error: membershipError } = await supabase
      .from('msp_user_memberships')
      .insert({
        msp_organization_id: invitation.organization_id,
        user_id: user.userId,
        user_email: user.userEmail,
        user_name: user.userName,
        user_tenant_id: user.tenantId,
        role: invitation.role,
      })
      .select()
      .single();

    if (membershipError) {
      return NextResponse.json(
        { error: 'Failed to join organization' },
        { status: 500 }
      );
    }

    // Mark invitation as accepted
    await supabase
      .from('msp_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    // Log the member joined event
    try {
      await logMemberJoined(
        {
          organization_id: invitation.organization_id,
          user_id: user.userId,
          user_email: user.userEmail,
          ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
          user_agent: request.headers.get('user-agent') || undefined,
        },
        membership.id,
        invitation.role,
        invitation.invited_by_email ?? 'unknown'
      );
    } catch (auditError) {
      // Don't fail the request if audit logging fails
    }

    // Send in-app notifications to other org members
    try {
      const { data: otherMembers } = await supabase
        .from('msp_user_memberships')
        .select('user_id, user_email')
        .eq('msp_organization_id', invitation.organization_id)
        .neq('user_id', user.userId);

      if (otherMembers && otherMembers.length > 0) {
        await notifyMemberJoined(
          otherMembers,
          user.userEmail,
          organization.name
        );
      }
    } catch (notifyError) {
      // Don't fail the request if notification fails
    }

    return NextResponse.json({
      success: true,
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      membership: {
        id: membership.id,
        role: membership.role,
      },
      message: `Welcome to ${organization.name}!`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/msp/invitations/accept
 * Validate an invitation token (for the accept page)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    // Validate token format
    const validation = validateMspInput(invitationTokenSchema, { token });
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid token format' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Find the invitation (without requiring auth)
    const { data: invitationData, error: invitationError } = await supabase
      .from('msp_invitations')
      .select('email, role, expires_at, accepted_at, msp_organizations(name)')
      .eq('token', token)
      .single();

    // Cast to proper type since Supabase types don't know about the relationship
    const invitation = invitationData as unknown as InvitationWithOrgName | null;

    if (invitationError || !invitation) {
      return NextResponse.json(
        { error: 'Invalid invitation' },
        { status: 404 }
      );
    }

    // Check if already accepted
    if (invitation.accepted_at) {
      return NextResponse.json(
        { error: 'This invitation has already been used' },
        { status: 400 }
      );
    }

    // Check if expired
    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'This invitation has expired' },
        { status: 400 }
      );
    }

    // Return basic info for the accept page
    return NextResponse.json({
      valid: true,
      email: invitation.email,
      role: invitation.role,
      organization_name: invitation.msp_organizations?.name || 'Unknown',
      expires_at: invitation.expires_at,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
