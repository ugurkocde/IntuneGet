/**
 * Update Policies API Routes
 * GET - List all policies for the user
 * POST - Create or update a policy
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import type { AppUpdatePolicyInput, AppUpdatePolicy } from '@/types/update-policies';
import type { Json } from '@/types/database';

/**
 * GET /api/update-policies
 * Get all update policies for the user, optionally filtered by tenant
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

    const searchParams = request.nextUrl.searchParams;
    const tenantId = searchParams.get('tenant_id');

    const supabase = createServerClient();

    // Build query - conditionally add tenant filter
    const { data: policies, error } = tenantId
      ? await supabase
          .from('app_update_policies')
          .select('*')
          .eq('user_id', user.userId)
          .eq('tenant_id', tenantId)
          .order('updated_at', { ascending: false })
      : await supabase
          .from('app_update_policies')
          .select('*')
          .eq('user_id', user.userId)
          .order('updated_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch policies' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      policies: policies as AppUpdatePolicy[],
      count: policies?.length || 0,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/update-policies
 * Create or update an update policy
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

    const body: AppUpdatePolicyInput = await request.json();

    // Validate required fields
    if (!body.winget_id || !body.tenant_id || !body.policy_type) {
      return NextResponse.json(
        { error: 'Missing required fields: winget_id, tenant_id, policy_type' },
        { status: 400 }
      );
    }

    // Validate policy type
    const validPolicyTypes = ['auto_update', 'notify', 'ignore', 'pin_version'];
    if (!validPolicyTypes.includes(body.policy_type)) {
      return NextResponse.json(
        { error: `Invalid policy_type. Must be one of: ${validPolicyTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Pin version requires a version
    if (body.policy_type === 'pin_version' && !body.pinned_version) {
      return NextResponse.json(
        { error: 'pinned_version is required for pin_version policy' },
        { status: 400 }
      );
    }

    // Auto-update requires deployment config
    if (body.policy_type === 'auto_update' && !body.deployment_config) {
      return NextResponse.json(
        { error: 'deployment_config is required for auto_update policy' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Check if policy already exists for this user/tenant/app
    const { data: existingPolicy } = await supabase
      .from('app_update_policies')
      .select('id')
      .eq('user_id', user.userId)
      .eq('tenant_id', body.tenant_id)
      .eq('winget_id', body.winget_id)
      .single();

    // Build policy data - cast deployment_config to Json for database compatibility
    const policyData = {
      user_id: user.userId,
      tenant_id: body.tenant_id,
      winget_id: body.winget_id,
      policy_type: body.policy_type,
      pinned_version: body.policy_type === 'pin_version' ? body.pinned_version : null,
      deployment_config: (body.deployment_config || null) as Json,
      original_upload_history_id: body.original_upload_history_id || null,
      is_enabled: body.is_enabled ?? true,
      updated_at: new Date().toISOString(),
    };

    let policy;
    let error;

    if (existingPolicy) {
      // Update existing policy
      const result = await supabase
        .from('app_update_policies')
        .update(policyData)
        .eq('id', existingPolicy.id)
        .select()
        .single();

      policy = result.data;
      error = result.error;
    } else {
      // Create new policy
      const result = await supabase
        .from('app_update_policies')
        .insert(policyData)
        .select()
        .single();

      policy = result.data;
      error = result.error;
    }

    if (error) {
      return NextResponse.json(
        { error: 'Failed to save policy' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      policy: policy as AppUpdatePolicy,
      created: !existingPolicy,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
