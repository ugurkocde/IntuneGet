/**
 * Trigger Updates API Route
 * POST - Manually trigger update(s) for apps
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import {
  AutoUpdateTrigger,
  getLatestInstallerInfo,
} from '@/lib/auto-update/trigger';
import type {
  TriggerUpdateRequest,
  TriggerUpdateResponse,
  AppUpdatePolicy,
} from '@/types/update-policies';
import type { Json } from '@/types/database';

/**
 * POST /api/updates/trigger
 * Manually trigger update deployment for one or more apps
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

    const body: TriggerUpdateRequest = await request.json();

    // Validate request - either single update or bulk
    let updateRequests: { winget_id: string; tenant_id: string }[] = [];

    if (body.updates && Array.isArray(body.updates) && body.updates.length > 0) {
      updateRequests = body.updates;
    } else if (body.winget_id && body.tenant_id) {
      updateRequests = [{ winget_id: body.winget_id, tenant_id: body.tenant_id }];
    } else {
      return NextResponse.json(
        { error: 'Either winget_id/tenant_id or updates array is required' },
        { status: 400 }
      );
    }

    // Limit bulk updates
    if (updateRequests.length > 10) {
      return NextResponse.json(
        { error: 'Maximum 10 updates can be triggered at once' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Get Supabase config for trigger
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const autoUpdateTrigger = new AutoUpdateTrigger(supabaseUrl, supabaseServiceKey);

    const response: TriggerUpdateResponse = {
      success: true,
      triggered: 0,
      failed: 0,
      results: [],
    };

    for (const req of updateRequests) {
      try {
        // Get the update check result for this app
        const { data: updateResult, error: updateError } = await supabase
          .from('update_check_results')
          .select('*')
          .eq('user_id', user.userId)
          .eq('tenant_id', req.tenant_id)
          .eq('winget_id', req.winget_id)
          .single();

        if (updateError || !updateResult) {
          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: 'Update not found',
          });
          continue;
        }

        // Get or create policy for this app
        let { data: policy } = await supabase
          .from('app_update_policies')
          .select('*')
          .eq('user_id', user.userId)
          .eq('tenant_id', req.tenant_id)
          .eq('winget_id', req.winget_id)
          .single();

        // If no policy exists, check for prior deployment to get config
        if (!policy) {
          // Get the original deployment config from upload_history
          const { data: uploadHistory } = await supabase
            .from('upload_history')
            .select('id, packaging_job_id')
            .eq('user_id', user.userId)
            .eq('intune_tenant_id', req.tenant_id)
            .eq('winget_id', req.winget_id)
            .order('deployed_at', { ascending: false })
            .limit(1)
            .single();

          if (!uploadHistory?.packaging_job_id) {
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: 'No prior deployment found - please deploy manually first and enable auto-update',
            });
            continue;
          }

          // Get the packaging job to extract deployment config
          const { data: packagingJob } = await supabase
            .from('packaging_jobs')
            .select('*')
            .eq('id', uploadHistory.packaging_job_id)
            .single();

          if (!packagingJob) {
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: 'Could not retrieve deployment configuration',
            });
            continue;
          }

          // Create deployment config from packaging job
          const deploymentConfig = {
            displayName: packagingJob.display_name,
            publisher: packagingJob.publisher,
            architecture: packagingJob.architecture || 'x64',
            installerType: packagingJob.installer_type,
            installCommand: packagingJob.install_command,
            uninstallCommand: packagingJob.uninstall_command,
            installScope: packagingJob.install_scope || 'system',
            detectionRules: packagingJob.detection_rules || [],
            assignedGroups: (packagingJob.package_config as { assignedGroups?: Json[] } | null)?.assignedGroups || [],
          };

          // Create a temporary policy for this manual trigger
          const { data: newPolicy, error: policyError } = await supabase
            .from('app_update_policies')
            .insert({
              user_id: user.userId,
              tenant_id: req.tenant_id,
              winget_id: req.winget_id,
              policy_type: 'notify', // Default to notify, user can change to auto_update later
              deployment_config: deploymentConfig,
              original_upload_history_id: uploadHistory.id,
              is_enabled: true,
            })
            .select()
            .single();

          if (policyError) {
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: `Failed to create policy: ${policyError.message}`,
            });
            continue;
          }

          policy = newPolicy;
        }

        // Temporarily enable auto-update for manual trigger
        const originalPolicyType = policy.policy_type;
        if (policy.policy_type !== 'auto_update') {
          await supabase
            .from('app_update_policies')
            .update({ policy_type: 'auto_update', is_enabled: true })
            .eq('id', policy.id);

          policy.policy_type = 'auto_update';
          policy.is_enabled = true;
        }

        // Get installer info
        const installerInfo = await getLatestInstallerInfo(supabase, req.winget_id);

        if (!installerInfo) {
          // Restore original policy type
          if (originalPolicyType !== 'auto_update') {
            await supabase
              .from('app_update_policies')
              .update({ policy_type: originalPolicyType })
              .eq('id', policy.id);
          }

          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: 'Could not get installer information for latest version',
          });
          continue;
        }

        installerInfo.currentVersion = updateResult.current_version;

        // Trigger the update
        const triggerResult = await autoUpdateTrigger.triggerAutoUpdate(
          policy as AppUpdatePolicy,
          installerInfo
        );

        // Restore original policy type if it was changed
        if (originalPolicyType !== 'auto_update') {
          await supabase
            .from('app_update_policies')
            .update({ policy_type: originalPolicyType })
            .eq('id', policy.id);
        }

        if (triggerResult.success) {
          response.triggered++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: true,
            packaging_job_id: triggerResult.packagingJobId,
          });
        } else {
          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: triggerResult.error || triggerResult.skipReason || 'Unknown error',
          });
        }
      } catch (error) {
        response.failed++;
        response.results.push({
          winget_id: req.winget_id,
          tenant_id: req.tenant_id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    response.success = response.failed === 0;

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
