/**
 * MSP Team Invitations API Routes
 * GET - List pending invitations
 * POST - Create and send a new invitation
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { hasPermission, type MspRole } from '@/lib/msp-permissions';
import { invitationSchema, validateMspInput } from '@/lib/validators/msp';
import {
  applyRateLimit,
  getUserKey,
  COMMUNITY_RATE_LIMIT,
} from '@/lib/rate-limit';
import { checkCanAddMember } from '@/lib/usage-limits';
import { logMemberInvited } from '@/lib/audit-logger';
import { sendTeamInvitationEmail, isEmailConfigured } from '@/lib/email/service';
import type { Database } from '@/types/database';

// Token expiry: 7 days
const INVITATION_EXPIRY_DAYS = 7;

// Type aliases for database tables
type MspUserMembershipRow = Database['public']['Tables']['msp_user_memberships']['Row'];
type MspOrganizationRow = Database['public']['Tables']['msp_organizations']['Row'];
type MspInvitationInsert = Database['public']['Tables']['msp_invitations']['Insert'];

// Joined query result types
interface MembershipWithOrganization extends MspUserMembershipRow {
  msp_organizations: MspOrganizationRow;
}

// Invitation list item type (selected fields)
interface InvitationListItem {
  id: string;
  email: string;
  role: MspRole;
  invited_by_email: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

// Created invitation type (selected fields)
interface CreatedInvitation {
  id: string;
  email: string;
  role: MspRole;
  expires_at: string;
  created_at: string;
}

// Membership for permission check
interface MembershipForPermission {
  msp_organization_id: string;
  role: MspRole;
}

// Existing invitation check type
interface ExistingInvitationCheck {
  id: string;
  expires_at: string;
}

// Existing member check type
interface ExistingMemberCheck {
  id: string;
}

/**
 * GET /api/msp/invitations
 * List all invitations for the user's organization
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

    // Get user's membership and organization
    const { data: membership, error: membershipError } = await supabase
      .from('msp_user_memberships')
      .select('*, msp_organizations!inner(*)')
      .eq('user_id', user.userId)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: 'MSP organization not found' },
        { status: 404 }
      );
    }

    // Cast to our typed interface for proper type inference
    const typedMembership = membership as unknown as MembershipWithOrganization;

    // Check permission
    const userRole = typedMembership.role;
    if (!hasPermission(userRole, 'invite_members')) {
      return NextResponse.json(
        { error: 'You do not have permission to view invitations' },
        { status: 403 }
      );
    }

    // Get invitations
    const { data: invitations, error: invitationsError } = await supabase
      .from('msp_invitations')
      .select('id, email, role, invited_by_email, expires_at, accepted_at, created_at')
      .eq('organization_id', typedMembership.msp_organization_id)
      .order('created_at', { ascending: false });

    if (invitationsError) {
      return NextResponse.json(
        { error: 'Failed to fetch invitations' },
        { status: 500 }
      );
    }

    // Cast to typed array
    const typedInvitations = (invitations || []) as InvitationListItem[];

    // Separate pending and processed invitations
    const now = new Date();
    const pending = typedInvitations.filter(
      (inv) => !inv.accepted_at && new Date(inv.expires_at) > now
    );
    const expired = typedInvitations.filter(
      (inv) => !inv.accepted_at && new Date(inv.expires_at) <= now
    );
    const accepted = typedInvitations.filter(
      (inv) => inv.accepted_at
    );

    return NextResponse.json({
      pending,
      expired,
      accepted,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/msp/invitations
 * Create a new invitation and send email
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

    // Rate limit
    const rateLimitResponse = await applyRateLimit(
      getUserKey(user.userId),
      COMMUNITY_RATE_LIMIT
    );
    if (rateLimitResponse) return rateLimitResponse;

    // Validate input
    const body = await request.json();
    const validation = validateMspInput(invitationSchema, body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { email, role } = validation.data;

    const supabase = createServerClient();

    // Get user's membership and organization
    const { data: membership, error: membershipError } = await supabase
      .from('msp_user_memberships')
      .select('*, msp_organizations!inner(*)')
      .eq('user_id', user.userId)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: 'MSP organization not found' },
        { status: 404 }
      );
    }

    // Cast to our typed interface for proper type inference
    const typedMembership = membership as unknown as MembershipWithOrganization;

    // Check permission
    const userRole = typedMembership.role;
    if (!hasPermission(userRole, 'invite_members')) {
      return NextResponse.json(
        { error: 'You do not have permission to invite members' },
        { status: 403 }
      );
    }

    const organization = typedMembership.msp_organizations;

    // Check member limit
    const limitCheck = await checkCanAddMember(typedMembership.msp_organization_id);
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: limitCheck.reason,
          upgradeRecommended: limitCheck.upgradeRecommended,
          recommendedTier: limitCheck.recommendedTier,
        },
        { status: 403 }
      );
    }

    // Check if user is already a member
    const { data: existingMember } = await supabase
      .from('msp_user_memberships')
      .select('id')
      .eq('msp_organization_id', typedMembership.msp_organization_id)
      .ilike('user_email', email)
      .single();

    if (existingMember) {
      return NextResponse.json(
        { error: 'This user is already a member of the organization' },
        { status: 409 }
      );
    }

    // Check if there's already a pending invitation for this email
    const { data: existingInvitation } = await supabase
      .from('msp_invitations')
      .select('id, expires_at')
      .eq('organization_id', typedMembership.msp_organization_id)
      .ilike('email', email)
      .is('accepted_at', null)
      .single();

    const typedExistingInvitation = existingInvitation as ExistingInvitationCheck | null;
    if (typedExistingInvitation && new Date(typedExistingInvitation.expires_at) > new Date()) {
      return NextResponse.json(
        { error: 'An invitation for this email is already pending' },
        { status: 409 }
      );
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');

    // Calculate expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    // Create invitation with explicit type for insert data
    const invitationData: MspInvitationInsert = {
      organization_id: typedMembership.msp_organization_id,
      email,
      role: role as MspInvitationInsert['role'],
      invited_by_user_id: user.userId,
      invited_by_email: user.userEmail,
      token,
      expires_at: expiresAt.toISOString(),
    };

    const { data: invitation, error: insertError } = await supabase
      .from('msp_invitations')
      .insert(invitationData)
      .select('id, email, role, expires_at, created_at')
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: 'Failed to create invitation' },
        { status: 500 }
      );
    }

    // Send invitation email via Resend
    let emailSent = false;
    if (isEmailConfigured()) {
      try {
        const emailResult = await sendTeamInvitationEmail(email, {
          inviter_name: user.userName || user.userEmail,
          inviter_email: user.userEmail,
          organization_name: organization.name,
          role,
          token,
          expires_at: expiresAt,
        });
        emailSent = emailResult.success;
      } catch (emailError) {
        // Email sending failed - invitation still created
      }
    }

    // Generate accept URL for fallback/manual sharing
    const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL || 'http://localhost:3000';
    const acceptUrl = `${baseUrl.replace(/\/$/, '')}/msp/invite/accept?token=${token}`;

    // Cast invitation to typed interface
    const typedInvitation = invitation as CreatedInvitation;

    // Log the invitation to audit log
    try {
      await logMemberInvited(
        {
          organization_id: typedMembership.msp_organization_id,
          user_id: user.userId,
          user_email: user.userEmail,
          ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
          user_agent: request.headers.get('user-agent') || undefined,
        },
        typedInvitation.id,
        email,
        role
      );
    } catch (auditError) {
      // Don't fail the request if audit logging fails
    }

    return NextResponse.json(
      {
        invitation: {
          ...typedInvitation,
          organization_name: organization.name,
        },
        emailSent,
        // Include acceptUrl for manual sharing when email fails or is not configured
        ...(emailSent ? {} : { acceptUrl }),
        message: emailSent
          ? `Invitation sent to ${email}`
          : `Invitation created for ${email}. Share the link manually.`,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/msp/invitations
 * Cancel a pending invitation
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

    const { searchParams } = new URL(request.url);
    const invitationId = searchParams.get('id');

    if (!invitationId) {
      return NextResponse.json(
        { error: 'Invitation ID is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Get user's membership
    const { data: membership, error: membershipError } = await supabase
      .from('msp_user_memberships')
      .select('msp_organization_id, role')
      .eq('user_id', user.userId)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: 'MSP organization not found' },
        { status: 404 }
      );
    }

    // Cast to typed interface for permission check
    const typedMembership = membership as MembershipForPermission;

    // Check permission
    if (!hasPermission(typedMembership.role, 'invite_members')) {
      return NextResponse.json(
        { error: 'You do not have permission to cancel invitations' },
        { status: 403 }
      );
    }

    // Delete the invitation (only if it belongs to user's org and is not accepted)
    const { error: deleteError, count } = await supabase
      .from('msp_invitations')
      .delete({ count: 'exact' })
      .eq('id', invitationId)
      .eq('organization_id', typedMembership.msp_organization_id)
      .is('accepted_at', null);

    if (deleteError) {
      return NextResponse.json(
        { error: 'Failed to cancel invitation' },
        { status: 500 }
      );
    }

    if (count === 0) {
      return NextResponse.json(
        { error: 'Invitation not found or already accepted' },
        { status: 404 }
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
