/**
 * MSP Members API Routes
 * GET - List all members of the organization
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';

/**
 * GET /api/msp/members
 * List all members of the user's organization
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

    // Get user's membership and verify they belong to an organization
    const { data: userMembership, error: membershipError } = await supabase
      .from('msp_user_memberships')
      .select('msp_organization_id, role')
      .eq('user_id', user.userId)
      .single();

    if (membershipError || !userMembership) {
      return NextResponse.json(
        { error: 'MSP organization not found' },
        { status: 404 }
      );
    }

    // Get all members of the organization
    const { data: members, error: membersError } = await supabase
      .from('msp_user_memberships')
      .select('id, user_id, user_email, user_name, role, created_at')
      .eq('msp_organization_id', userMembership.msp_organization_id)
      .order('created_at', { ascending: true });

    if (membersError) {
      return NextResponse.json(
        { error: 'Failed to fetch members' },
        { status: 500 }
      );
    }

    // Mark the current user
    const membersWithCurrent = members.map((member: { user_id: string }) => ({
      ...member,
      is_current_user: member.user_id === user.userId,
    }));

    return NextResponse.json({
      members: membersWithCurrent,
      current_user_role: userMembership.role,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
