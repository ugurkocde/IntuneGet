/**
 * Update Policy by ID API Routes
 * GET - Get a specific policy
 * PATCH - Update a specific policy
 * DELETE - Delete a specific policy
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import type { AppUpdatePolicy, UpdatePolicyType } from '@/types/update-policies';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/update-policies/[id]
 * Get a specific update policy
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const supabase = createServerClient();

    // Get policy by ID, ensuring it belongs to the user
    const { data: policy, error } = await supabase
      .from('app_update_policies')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json(
        { error: 'Failed to fetch policy' },
        { status: 500 }
      );
    }

    if (!policy) {
      return NextResponse.json(
        { error: 'Policy not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      policy: policy as AppUpdatePolicy,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/update-policies/[id]
 * Update a specific policy
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json();

    const supabase = createServerClient();

    // Verify policy exists and belongs to user
    const { data: existingPolicy, error: fetchError } = await supabase
      .from('app_update_policies')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      return NextResponse.json(
        { error: 'Failed to fetch policy' },
        { status: 500 }
      );
    }

    if (!existingPolicy) {
      return NextResponse.json(
        { error: 'Policy not found' },
        { status: 404 }
      );
    }

    // Validate policy type if provided
    if (body.policy_type) {
      const validPolicyTypes: UpdatePolicyType[] = ['auto_update', 'notify', 'ignore', 'pin_version'];
      if (!validPolicyTypes.includes(body.policy_type)) {
        return NextResponse.json(
          { error: `Invalid policy_type. Must be one of: ${validPolicyTypes.join(', ')}` },
          { status: 400 }
        );
      }

      // Validate constraints based on policy type
      if (body.policy_type === 'pin_version' && !body.pinned_version && !existingPolicy.pinned_version) {
        return NextResponse.json(
          { error: 'pinned_version is required for pin_version policy' },
          { status: 400 }
        );
      }

      if (body.policy_type === 'auto_update' && !body.deployment_config && !existingPolicy.deployment_config) {
        return NextResponse.json(
          { error: 'deployment_config is required for auto_update policy' },
          { status: 400 }
        );
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Only include fields that are provided
    if (body.policy_type !== undefined) updateData.policy_type = body.policy_type;
    if (body.pinned_version !== undefined) updateData.pinned_version = body.pinned_version;
    if (body.deployment_config !== undefined) updateData.deployment_config = body.deployment_config;
    if (body.is_enabled !== undefined) updateData.is_enabled = body.is_enabled;
    if (body.original_upload_history_id !== undefined) updateData.original_upload_history_id = body.original_upload_history_id;

    // Reset consecutive failures if explicitly enabled
    if (body.is_enabled === true) {
      updateData.consecutive_failures = 0;
    }

    // Update the policy
    const { data: policy, error } = await supabase
      .from('app_update_policies')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update policy' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      policy: policy as AppUpdatePolicy,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/update-policies/[id]
 * Delete a specific policy
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const supabase = createServerClient();

    // Delete the policy (only if it belongs to the user)
    const { error, count } = await supabase
      .from('app_update_policies')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', user.userId);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to delete policy' },
        { status: 500 }
      );
    }

    if (count === 0) {
      return NextResponse.json(
        { error: 'Policy not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      deleted: true,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
