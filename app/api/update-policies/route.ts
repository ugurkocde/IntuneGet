/**
 * Update Policies API Routes
 * GET - List all policies for the user
 * POST - Create or update a policy
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getCatalogSource } from '@/lib/catalog';
import { parseAccessToken } from '@/lib/auth-utils';
import { buildDeploymentConfigForApp } from '@/lib/update-policies/build-deployment-config';
import type { AppUpdatePolicyInput, AppUpdatePolicy, DeploymentConfig } from '@/types/update-policies';
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

    const supabase = createServerClient();

    // Fields the client may omit for pin_version / auto_update. We derive them
    // server-side below so the bell-icon dropdown can set these policies with
    // just { winget_id, tenant_id, policy_type }.
    let derivedPinnedVersion = body.pinned_version || null;
    let derivedDeploymentConfig: DeploymentConfig | null = body.deployment_config || null;
    let derivedOriginalUploadHistoryId = body.original_upload_history_id || null;

    // Pin version requires a version. If the client didn't send one, derive the
    // currently deployed version for this app.
    if (body.policy_type === 'pin_version' && !derivedPinnedVersion) {
      const { data: updateRow } = await supabase
        .from('update_check_results')
        .select('current_version')
        .eq('user_id', user.userId)
        .eq('tenant_id', body.tenant_id)
        .eq('winget_id', body.winget_id)
        .maybeSingle();

      derivedPinnedVersion = updateRow?.current_version || null;

      if (!derivedPinnedVersion) {
        const { data: latestUpload } = await supabase
          .from('upload_history')
          .select('version')
          .eq('user_id', user.userId)
          .eq('intune_tenant_id', body.tenant_id)
          .eq('winget_id', body.winget_id)
          .order('deployed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        derivedPinnedVersion = latestUpload?.version || null;
      }

      if (!derivedPinnedVersion) {
        return NextResponse.json(
          { error: 'pinned_version is required for pin_version policy' },
          { status: 400 }
        );
      }
    }

    // Auto-update requires a deployment config. If the client didn't send one,
    // build it from the app's prior deployment or the catalog.
    if (body.policy_type === 'auto_update' && !derivedDeploymentConfig) {
      // Resolve the app's latest version: prefer the update check row, fall
      // back to the catalog's latest_version.
      const { data: updateRow } = await supabase
        .from('update_check_results')
        .select('latest_version')
        .eq('user_id', user.userId)
        .eq('tenant_id', body.tenant_id)
        .eq('winget_id', body.winget_id)
        .maybeSingle();

      let latestVersion = updateRow?.latest_version || '';
      if (!latestVersion) {
        const catalogApp = await getCatalogSource().getAppForInstaller(body.winget_id);
        latestVersion = catalogApp?.latest_version || '';
      }

      // Read the user's global carry-over setting (same source as the trigger route)
      const { data: userSettingsRow } = await (supabase as any)
        .from('user_settings')
        .select('settings')
        .eq('user_id', user.userId)
        .maybeSingle();
      const userSettings = (userSettingsRow?.settings as Record<string, unknown> | null) || null;
      const globalCarryOver = Boolean(userSettings?.carryOverAssignments);

      const built = await buildDeploymentConfigForApp(supabase, {
        userId: user.userId,
        tenantId: body.tenant_id,
        wingetId: body.winget_id,
        latestVersion,
        globalCarryOver,
      });

      if (built.status !== 'ok') {
        return NextResponse.json(
          {
            error:
              built.status === 'orphaned_job'
                ? 'Could not retrieve the saved deployment configuration for this app.'
                : 'Auto-update requires a prior deployment of this app, or the app must be in the catalog.',
          },
          { status: 400 }
        );
      }

      derivedDeploymentConfig = built.deploymentConfig;
      derivedOriginalUploadHistoryId = built.originalUploadHistoryId;
    }

    // Check if policy already exists for this user/tenant/app
    const { data: existingPolicy } = await supabase
      .from('app_update_policies')
      .select('id')
      .eq('user_id', user.userId)
      .eq('tenant_id', body.tenant_id)
      .eq('winget_id', body.winget_id)
      .maybeSingle();

    // Build policy data - cast deployment_config to Json for database compatibility
    const policyData = {
      user_id: user.userId,
      tenant_id: body.tenant_id,
      winget_id: body.winget_id,
      policy_type: body.policy_type,
      pinned_version: body.policy_type === 'pin_version' ? derivedPinnedVersion : null,
      deployment_config: (derivedDeploymentConfig || null) as Json,
      original_upload_history_id: derivedOriginalUploadHistoryId,
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
