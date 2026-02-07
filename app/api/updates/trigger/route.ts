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
  DeploymentConfig,
} from '@/types/update-policies';
import type { PackageAssignment } from '@/types/upload';
import type { DetectionRule } from '@/types/intune';
import type { Json } from '@/types/database';

interface PackageConfigWithAssignments {
  assignments?: PackageAssignment[];
  assignedGroups?: Array<{
    groupId?: string;
    groupName?: string;
    assignmentType?: 'required' | 'available' | 'uninstall';
  }>;
  assignmentMigration?: {
    carryOverAssignments?: boolean;
    removeAssignmentsFromPreviousApp?: boolean;
  };
  carryOverAssignments?: boolean;
  removeAssignmentsFromPreviousApp?: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePackageAssignments(packageConfig: unknown): PackageAssignment[] {
  if (!isObject(packageConfig)) {
    return [];
  }

  const assignments = packageConfig.assignments;
  if (Array.isArray(assignments)) {
    return assignments.filter((assignment): assignment is PackageAssignment => {
      if (!isObject(assignment)) {
        return false;
      }

      const type = assignment.type;
      const intent = assignment.intent;
      if (
        type !== 'allUsers' &&
        type !== 'allDevices' &&
        type !== 'group'
      ) {
        return false;
      }

      if (
        intent !== 'required' &&
        intent !== 'available' &&
        intent !== 'uninstall'
      ) {
        return false;
      }

      if (type === 'group') {
        return typeof assignment.groupId === 'string' && assignment.groupId.length > 0;
      }

      return true;
    });
  }

  const assignedGroups = packageConfig.assignedGroups;
  if (!Array.isArray(assignedGroups)) {
    return [];
  }

  return assignedGroups
    .filter((group): group is { groupId: string; groupName?: string; assignmentType?: 'required' | 'available' | 'uninstall' } => {
      return isObject(group) && typeof group.groupId === 'string' && group.groupId.length > 0;
    })
    .map((group) => ({
      type: 'group',
      groupId: group.groupId,
      groupName: typeof group.groupName === 'string' ? group.groupName : undefined,
      intent: group.assignmentType || 'required',
    }));
}

function parseAssignmentMigration(packageConfig: unknown): DeploymentConfig['assignmentMigration'] {
  if (!isObject(packageConfig)) {
    return {
      carryOverAssignments: false,
      removeAssignmentsFromPreviousApp: false,
    };
  }

  const typedConfig = packageConfig as PackageConfigWithAssignments;
  const nested = typedConfig.assignmentMigration;

  const carryOverAssignments = Boolean(
    nested?.carryOverAssignments ?? typedConfig.carryOverAssignments
  );
  const removeAssignmentsFromPreviousApp = Boolean(
    nested?.removeAssignmentsFromPreviousApp ?? typedConfig.removeAssignmentsFromPreviousApp
  );

  return {
    carryOverAssignments,
    removeAssignmentsFromPreviousApp,
  };
}

function parseDetectionRules(value: unknown): DetectionRule[] {
  return Array.isArray(value) ? (value as DetectionRule[]) : [];
}

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
      let restorePolicyState: {
        id: string;
        policy_type: AppUpdatePolicy['policy_type'];
        is_enabled: boolean;
      } | null = null;

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
          const packageConfig = packagingJob.package_config;
          const parsedAssignments = parsePackageAssignments(packageConfig);
          const assignmentMigration = parseAssignmentMigration(packageConfig);

          const deploymentConfig: DeploymentConfig = {
            displayName: packagingJob.display_name,
            publisher: packagingJob.publisher || 'Unknown Publisher',
            architecture: packagingJob.architecture || 'x64',
            installerType: packagingJob.installer_type,
            installCommand: packagingJob.install_command || '',
            uninstallCommand: packagingJob.uninstall_command || '',
            installScope: packagingJob.install_scope || 'system',
            detectionRules: parseDetectionRules(packagingJob.detection_rules),
            assignments: parsedAssignments,
            forceCreateNewApp: true,
            assignmentMigration,
          };

          // Create a temporary policy for this manual trigger
          const { data: newPolicy, error: policyError } = await supabase
            .from('app_update_policies')
            .insert({
              user_id: user.userId,
              tenant_id: req.tenant_id,
              winget_id: req.winget_id,
              policy_type: 'notify', // Default to notify, user can change to auto_update later
              deployment_config: deploymentConfig as unknown as Json,
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

        // Temporarily enable auto-update for manual trigger.
        // We always restore this in finally if we changed it.
        const shouldTemporarilyEnable =
          policy.policy_type !== 'auto_update' || !policy.is_enabled;
        if (shouldTemporarilyEnable) {
          restorePolicyState = {
            id: policy.id,
            policy_type: policy.policy_type,
            is_enabled: policy.is_enabled,
          };

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
        installerInfo.currentIntuneAppId = updateResult.intune_app_id;

        // Trigger the update
        const triggerResult = await autoUpdateTrigger.triggerAutoUpdate(
          policy as AppUpdatePolicy,
          installerInfo
        );

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
      } finally {
        if (restorePolicyState) {
          const { error: restoreError } = await supabase
            .from('app_update_policies')
            .update({
              policy_type: restorePolicyState.policy_type,
              is_enabled: restorePolicyState.is_enabled,
            })
            .eq('id', restorePolicyState.id);

          if (restoreError) {
            console.error(
              `Failed to restore update policy ${restorePolicyState.id}:`,
              restoreError.message
            );
          }
        }
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
