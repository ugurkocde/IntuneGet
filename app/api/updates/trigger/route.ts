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
import {
  isGitHubActionsConfigured,
  triggerPackagingWorkflow,
} from '@/lib/github-actions';
import { getAppConfig } from '@/lib/config';
import { getFeatureFlags } from '@/lib/features';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import { generateDetectionRules, generateInstallCommand, generateUninstallCommand } from '@/lib/detection-rules';
import { buildIntuneAppDescription } from '@/lib/intune-description';
import type { WorkflowInputs } from '@/lib/github-actions';
import type {
  TriggerUpdateRequest,
  TriggerUpdateResponse,
  AppUpdatePolicy,
  DeploymentConfig,
} from '@/types/update-policies';
import type { IntuneAppCategorySelection, PackageAssignment } from '@/types/upload';
import type { DetectionRule } from '@/types/intune';
import type { NormalizedInstaller } from '@/types/winget';
import type { Json } from '@/types/database';

interface PackageConfigWithAssignments {
  assignments?: PackageAssignment[];
  categories?: IntuneAppCategorySelection[];
  categoryIds?: string[];
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

function parseAssignmentMigration(packageConfig: unknown): DeploymentConfig['assignmentMigration'] | undefined {
  if (!isObject(packageConfig)) {
    return undefined;
  }

  const typedConfig = packageConfig as PackageConfigWithAssignments;
  const nested = typedConfig.assignmentMigration;

  // If no migration config was explicitly set, return undefined so the
  // caller can fall back to the user's global setting.
  const hasExplicitNested = nested && (
    nested.carryOverAssignments !== undefined ||
    nested.removeAssignmentsFromPreviousApp !== undefined
  );
  const hasExplicitTop =
    typedConfig.carryOverAssignments !== undefined ||
    typedConfig.removeAssignmentsFromPreviousApp !== undefined;

  if (!hasExplicitNested && !hasExplicitTop) {
    return undefined;
  }

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

function parsePackageCategories(packageConfig: unknown): IntuneAppCategorySelection[] {
  if (!isObject(packageConfig)) {
    return [];
  }

  const typedConfig = packageConfig as PackageConfigWithAssignments;
  const parsedCategories: IntuneAppCategorySelection[] = [];

  if (Array.isArray(typedConfig.categories)) {
    for (const category of typedConfig.categories) {
      if (!isObject(category)) {
        continue;
      }

      if (typeof category.id !== 'string' || category.id.length === 0) {
        continue;
      }

      if (typeof category.displayName !== 'string' || category.displayName.length === 0) {
        continue;
      }

      parsedCategories.push({
        id: category.id,
        displayName: category.displayName,
      });
    }
  }

  // Backward-compatible support for legacy shape with category IDs only
  if (parsedCategories.length === 0 && Array.isArray(typedConfig.categoryIds)) {
    for (const categoryId of typedConfig.categoryIds) {
      if (typeof categoryId !== 'string' || categoryId.length === 0) {
        continue;
      }
      parsedCategories.push({
        id: categoryId,
        displayName: categoryId,
      });
    }
  }

  const seen = new Set<string>();
  return parsedCategories.filter((category) => {
    if (seen.has(category.id)) {
      return false;
    }
    seen.add(category.id);
    return true;
  });
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

          let deploymentConfig: DeploymentConfig;
          let originalUploadHistoryId: string | null = null;

          if (uploadHistory?.packaging_job_id) {
            // Has prior deployment: extract config from packaging job
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

            const packageConfig = packagingJob.package_config;
            const parsedAssignments = parsePackageAssignments(packageConfig);
            const parsedCategories = parsePackageCategories(packageConfig);
            let assignmentMigration = parseAssignmentMigration(packageConfig);

            // If no explicit migration config was stored on the packaging job,
            // fall back to the user's global carryOverAssignments setting.
            if (!assignmentMigration) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { data: userSettingsRow, error: settingsError } = await (supabase as any)
                .from('user_settings')
                .select('settings')
                .eq('user_id', user.userId)
                .maybeSingle();
              if (settingsError) {
                console.warn(
                  `Failed to read user_settings for ${user.userId}: ${settingsError.message}`
                );
              }
              const globalCarryOver = Boolean(
                (userSettingsRow?.settings as Record<string, unknown> | null)?.carryOverAssignments
              );
              assignmentMigration = {
                carryOverAssignments: globalCarryOver,
                removeAssignmentsFromPreviousApp: globalCarryOver,
              };
            }

            deploymentConfig = {
              displayName: packagingJob.display_name,
              publisher: packagingJob.publisher || 'Unknown Publisher',
              architecture: packagingJob.architecture || 'x64',
              installerType: packagingJob.installer_type,
              installCommand: packagingJob.install_command || '',
              uninstallCommand: packagingJob.uninstall_command || '',
              installScope: packagingJob.install_scope || 'system',
              detectionRules: parseDetectionRules(packagingJob.detection_rules),
              assignments: parsedAssignments,
              categories: parsedCategories,
              forceCreateNewApp: true,
              assignmentMigration,
            };
            originalUploadHistoryId = uploadHistory.id;
          } else {
            // No prior deployment: build config from curated catalog data
            const defaultConfig = await buildDefaultDeploymentConfig(
              supabase,
              req.winget_id,
              updateResult.latest_version
            );

            if (!defaultConfig) {
              response.failed++;
              response.results.push({
                winget_id: req.winget_id,
                tenant_id: req.tenant_id,
                success: false,
                error: 'Could not determine deployment configuration for this app',
              });
              continue;
            }

            deploymentConfig = defaultConfig;
          }

          // Create a policy for this manual trigger
          const { data: newPolicy, error: policyError } = await supabase
            .from('app_update_policies')
            .insert({
              user_id: user.userId,
              tenant_id: req.tenant_id,
              winget_id: req.winget_id,
              policy_type: 'notify',
              deployment_config: deploymentConfig as unknown as Json,
              original_upload_history_id: originalUploadHistoryId,
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

        // Trigger the update (creates packaging job + history record in DB)
        // Manual triggers skip rate limits since the user explicitly confirmed
        const triggerResult = await autoUpdateTrigger.triggerAutoUpdate(
          policy as AppUpdatePolicy,
          installerInfo,
          { skipRateLimits: true, skipPriorDeploymentCheck: true }
        );

        if (triggerResult.success && triggerResult.packagingJobId) {
          // Dispatch the GitHub Actions workflow to actually run the packaging
          const features = getFeatureFlags();
          const isLocalPackagerMode = features.localPackager;

          if (!isLocalPackagerMode && isGitHubActionsConfigured()) {
            const appConfig = getAppConfig();
            const baseUrl = appConfig.app.url || (process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : 'http://localhost:3000');
            const callbackUrl = `${baseUrl}/api/package/callback`;

            const deploymentConfig = policy.deployment_config as unknown as DeploymentConfig;

            const workflowInputs: WorkflowInputs = {
              jobId: triggerResult.packagingJobId,
              tenantId: req.tenant_id,
              wingetId: req.winget_id,
              displayName: deploymentConfig.displayName || installerInfo.displayName,
              description: buildIntuneAppDescription({
                description: deploymentConfig.description,
                fallback: `Deployed via IntuneGet from Winget: ${req.winget_id}`,
              }),
              publisher: deploymentConfig.publisher || 'Unknown Publisher',
              version: installerInfo.latestVersion,
              architecture: deploymentConfig.architecture || 'x64',
              installerUrl: installerInfo.installerUrl,
              installerSha256: installerInfo.installerSha256 || '',
              installerType: installerInfo.installerType || deploymentConfig.installerType || 'exe',
              silentSwitches: extractSilentSwitches(
                deploymentConfig.installCommand || '',
                installerInfo.installerType || deploymentConfig.installerType || 'exe'
              ),
              uninstallCommand: deploymentConfig.uninstallCommand || '',
              callbackUrl,
              detectionRules: deploymentConfig.detectionRules
                ? JSON.stringify(deploymentConfig.detectionRules)
                : undefined,
              assignments: deploymentConfig.assignments
                ? JSON.stringify(deploymentConfig.assignments)
                : undefined,
              categories: deploymentConfig.categories
                ? JSON.stringify(deploymentConfig.categories)
                : undefined,
              installScope: (deploymentConfig.installScope === 'user' ? 'user' : 'machine') as 'machine' | 'user',
              forceCreate: deploymentConfig.forceCreateNewApp !== false,
            };

            const isBatch = updateRequests.length > 1;
            await triggerPackagingWorkflow(workflowInputs, undefined, {
              skipRunCapture: isBatch,
            });
          }
          // If local packager mode, the job stays in 'queued'/'packaging' for local pickup

          response.triggered++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: true,
            packaging_job_id: triggerResult.packagingJobId,
          });
        } else if (!triggerResult.success) {
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

/**
 * Build a deployment config from curated catalog data for apps
 * that were never deployed through IntuneGet.
 */
async function buildDefaultDeploymentConfig(
  supabase: ReturnType<typeof createServerClient>,
  wingetId: string,
  latestVersion: string
): Promise<DeploymentConfig | null> {
  // Get curated app info
  const { data: curatedApp } = await supabase
    .from('curated_apps')
    .select('name, publisher')
    .eq('winget_id', wingetId)
    .single();

  if (!curatedApp) {
    return null;
  }

  // Get version history for installer metadata
  const { data: versionInfo } = await supabase
    .from('version_history')
    .select('installer_url, installer_sha256, installer_type, installers')
    .eq('winget_id', wingetId)
    .eq('version', latestVersion)
    .single();

  if (!versionInfo?.installer_url) {
    return null;
  }

  // Resolve architecture-specific installer (prefer x64)
  let installerUrl = versionInfo.installer_url;
  let installerSha256 = versionInfo.installer_sha256 || '';
  let installerType = versionInfo.installer_type || 'exe';
  let architecture = 'x64';

  if (versionInfo.installers && Array.isArray(versionInfo.installers)) {
    type InstallerEntry = { Architecture?: string; InstallerUrl?: string; InstallerSha256?: string; InstallerType?: string };
    const installers = versionInfo.installers as InstallerEntry[];
    const x64Installer = installers.find(
      (i) => i.Architecture === 'x64'
    );
    if (x64Installer) {
      installerUrl = x64Installer.InstallerUrl || installerUrl;
      installerSha256 = x64Installer.InstallerSha256 || installerSha256;
      installerType = x64Installer.InstallerType || installerType;
    } else if (installers.length > 0) {
      // Use first available installer's architecture
      const first = installers[0];
      if (first?.Architecture) {
        architecture = first.Architecture.toLowerCase();
      }
    }
  }

  // Build a NormalizedInstaller for detection rule generation
  const normalizedInstaller: NormalizedInstaller = {
    architecture: architecture as NormalizedInstaller['architecture'],
    url: installerUrl,
    sha256: installerSha256,
    type: installerType as NormalizedInstaller['type'],
    scope: 'machine',
  };

  const installCommand = generateInstallCommand(normalizedInstaller, 'machine');
  const uninstallCommand = generateUninstallCommand(normalizedInstaller, curatedApp.name);
  const detectionRules = generateDetectionRules(
    normalizedInstaller,
    curatedApp.name,
    wingetId,
    latestVersion
  );

  return {
    displayName: curatedApp.name,
    publisher: curatedApp.publisher || 'Unknown Publisher',
    architecture,
    installerType,
    installCommand,
    uninstallCommand,
    installScope: 'system',
    detectionRules,
    assignments: [],
    categories: [],
    forceCreateNewApp: true,
  };
}
