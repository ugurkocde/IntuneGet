/**
 * Auto-Update Trigger Service
 * Handles automated app update deployments based on configured policies
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  AppUpdatePolicy,
  AutoUpdateHistory,
  DeploymentConfig,
  AutoUpdateSafetyConfig,
  DEFAULT_SAFETY_CONFIG,
  classifyUpdateType,
  canAutoUpdate,
} from '@/types/update-policies';
import type { IntuneAppCategorySelection, PackageAssignment } from '@/types/upload';
import { getCatalogSource } from '@/lib/catalog';
import {
  normalizeInstallerSha256,
  selectWingetInstaller,
} from '@/lib/qa/candidate';
import { ensureQaDemand, type QaDemandResult } from '@/lib/qa/demand';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import { generateInstallCommand } from '@/lib/detection-rules';
import { normalizeInstaller } from '@/lib/manifest-api';
import { upgradeLegacyPackageDefaults } from '@/lib/update-policies/upgrade-legacy-package-defaults';
import {
  applyApplicationPackagingAdapter,
  resolveApplicationInstallScope,
} from '@/lib/packaging-adapters';
import type { NormalizedInstaller, WingetInstaller, WingetScope } from '@/types/winget';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

interface TriggerResult {
  success: boolean;
  packagingJobId?: string;
  historyId?: string;
  packageProfileSha256?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
  code?: 'QA_FAILED_CURRENT_VERSION' | 'QA_NOT_PASSED_CURRENT_VERSION';
}

interface UpdateInfo {
  wingetId: string;
  currentVersion: string;
  latestVersion: string;
  displayName: string;
  installerUrl: string;
  installerSha256: string;
  installerType: string;
  installCommand?: string;
  silentSwitches?: string;
  installerSuccessCodes?: number[];
  installScope?: WingetScope;
  nestedInstallerType?: string;
  nestedInstallerPath?: string;
  currentIntuneAppId?: string;
}

interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
  retryAfterMinutes?: number;
}

function buildCurrentVersionInstallCommand(installer: NormalizedInstaller): string {
  // The packager extracts arguments from this command and separately resolves
  // the nested payload path. Keep a command-shaped value for archive packages
  // so their nested installer's current silent switches are retained.
  if (installer.type === 'zip') {
    const nestedFileName = installer.nestedInstallerPath || 'installer.exe';
    return `"${nestedFileName}" ${installer.silentArgs || ''}`.trim();
  }

  return generateInstallCommand(installer, installer.scope || 'machine');
}

function normalizeAssignments(config: DeploymentConfig): PackageAssignment[] {
  if (Array.isArray(config.assignments) && config.assignments.length > 0) {
    return config.assignments;
  }

  if (!Array.isArray(config.assignedGroups) || config.assignedGroups.length === 0) {
    return [];
  }

  return config.assignedGroups
    .filter((group) => Boolean(group.groupId))
    .map((group) => ({
      type: 'group',
      groupId: group.groupId,
      groupName: group.groupName,
      intent: group.assignmentType,
    }));
}

function normalizeCategories(config: DeploymentConfig): IntuneAppCategorySelection[] {
  if (!Array.isArray(config.categories) || config.categories.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: IntuneAppCategorySelection[] = [];

  for (const category of config.categories) {
    if (!category || typeof category.id !== 'string' || category.id.length === 0) {
      continue;
    }
    if (!category.displayName || typeof category.displayName !== 'string') {
      continue;
    }
    if (seen.has(category.id)) {
      continue;
    }

    seen.add(category.id);
    normalized.push({
      id: category.id,
      displayName: category.displayName,
    });
  }

  return normalized;
}

/**
 * Main service for triggering auto-updates
 */
export class AutoUpdateTrigger {
  private supabase: SupabaseClient;
  private safetyConfig: AutoUpdateSafetyConfig;

  constructor(
    supabaseUrl: string,
    supabaseServiceKey: string,
    safetyConfig: AutoUpdateSafetyConfig = DEFAULT_SAFETY_CONFIG
  ) {
    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
    this.safetyConfig = safetyConfig;
  }

  /**
   * Trigger an auto-update for a specific policy
   */
  async triggerAutoUpdate(
    policy: AppUpdatePolicy,
    updateInfo: UpdateInfo,
    options?: { skipRateLimits?: boolean; skipPriorDeploymentCheck?: boolean }
  ): Promise<TriggerResult> {
    try {
      // Safety check 1: Verify policy allows auto-update
      if (!canAutoUpdate(policy)) {
        return {
          success: false,
          skipped: true,
          skipReason: 'Policy does not allow auto-update or is disabled',
        };
      }

      // Safety check 2: Verify deployment config exists
      if (!policy.deployment_config) {
        return {
          success: false,
          error: 'No deployment configuration saved for this policy',
        };
      }

      // Safety check 3: Verify prior deployment exists (if required)
      if (this.safetyConfig.requirePriorDeployment && !options?.skipPriorDeploymentCheck && !policy.original_upload_history_id) {
        return {
          success: false,
          error: 'Auto-update requires a prior manual deployment',
        };
      }

      // Safety check 4: Check rate limits (skipped for manual bulk triggers)
      if (!options?.skipRateLimits) {
        const rateLimitResult = await this.checkRateLimits(policy.user_id, policy.tenant_id, policy.id);
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            skipped: true,
            skipReason: rateLimitResult.reason,
          };
        }
      }

      // Safety check 5: Verify tenant consent is still active
      if (this.safetyConfig.verifyConsentBeforeDeployment) {
        const consentValid = await this.verifyTenantConsent(policy.tenant_id);
        if (!consentValid) {
          return {
            success: false,
            error: 'Tenant consent is no longer active',
          };
        }
      }

      // Backfill PSADT settings from the original deployment for policies
      // created before psadtConfig was stored on deployment_config
      await this.ensurePsadtConfig(policy);

      // Policies created by older IntuneGet releases can contain generated
      // defaults that were never valid at runtime (for example an MSI
      // {PRODUCT_CODE} token and a guessed installation folder). Upgrade only
      // those exact legacy shapes before QA so the same corrected profile is
      // later used by both GitHub Actions and the self-hosted packager.
      await this.ensureCurrentPackageDefaults(policy, updateInfo);

      const storedDeploymentConfig = policy.deployment_config as DeploymentConfig;
      const effectiveInstallScope = resolveApplicationInstallScope(
        updateInfo.wingetId,
        storedDeploymentConfig.installScope || updateInfo.installScope
      );
      updateInfo = { ...updateInfo, installScope: effectiveInstallScope };
      const deploymentConfig: DeploymentConfig = {
        ...storedDeploymentConfig,
        installScope: effectiveInstallScope,
        psadtConfig: applyApplicationPackagingAdapter(
          updateInfo.wingetId,
          storedDeploymentConfig.psadtConfig || DEFAULT_PSADT_CONFIG
        ),
      };
      // Keep the effective adapter in this update attempt so QA and the job
      // receive the same config, without persisting derived adapter output into
      // the customer's policy. A later adapter revision is therefore reapplied.
      policy.deployment_config = deploymentConfig;
      const sourceInstallerType =
        updateInfo.installerType || deploymentConfig.installerType || 'exe';
      const customInstallCommand = deploymentConfig.psadtConfig?.installCommand?.trim();
      const effectiveInstallCommand =
        customInstallCommand || updateInfo.installCommand || deploymentConfig.installCommand || '';
      const qaDemand = await ensureQaDemand(this.supabase, {
        wingetId: updateInfo.wingetId,
        displayName: deploymentConfig.displayName || updateInfo.displayName,
        publisher: deploymentConfig.publisher || 'Unknown Publisher',
        version: updateInfo.latestVersion,
        architecture: deploymentConfig.architecture || 'x64',
        installerUrl: updateInfo.installerUrl,
        installerSha256: updateInfo.installerSha256,
        installerType: sourceInstallerType,
        nestedInstallerType: updateInfo.nestedInstallerType,
        nestedInstallerPath: updateInfo.nestedInstallerPath,
        // An explicit PSADT override remains authoritative. Otherwise QA must
        // exercise the current version's manifest-derived command, not the
        // generated command saved with the previous deployment.
        silentSwitches: updateInfo.silentSwitches && !customInstallCommand
          ? updateInfo.silentSwitches
          : extractSilentSwitches(
              effectiveInstallCommand,
              sourceInstallerType,
              updateInfo.nestedInstallerType
            ),
        installerSuccessCodes: updateInfo.installerSuccessCodes,
        uninstallCommand: deploymentConfig.uninstallCommand || '',
        installScope: updateInfo.installScope ||
          (deploymentConfig.installScope === 'user' ? 'user' : 'machine'),
        psadtConfig: deploymentConfig.psadtConfig
          ? JSON.stringify(deploymentConfig.psadtConfig)
          : undefined,
        detectionRules: JSON.stringify(deploymentConfig.detectionRules || []),
        priority: 1500,
        demandSource: 'auto_update',
      });
      if (qaDemand.state === 'failed') {
        return {
          success: false,
          skipped: true,
          skipReason: qaDemand.failureSummary,
          code: 'QA_FAILED_CURRENT_VERSION',
          packageProfileSha256: qaDemand.identity.executionProfileSha256,
        };
      }

      // Determine update type
      const updateType = classifyUpdateType(updateInfo.currentVersion, updateInfo.latestVersion);

      // Create auto-update history record
      const historyRecord = await this.createHistoryRecord(policy.id, updateInfo, updateType);

      // Create packaging job
      const packagingJob = await this.createPackagingJob(
        policy,
        updateInfo,
        historyRecord.id,
        qaDemand
      );

      // Update history with job reference
      await this.updateHistoryRecord(historyRecord.id, {
        packaging_job_id: packagingJob.id,
        status: qaDemand.state === 'passed'
          ? 'packaging'
          : qaDemand.state === 'waiting'
            ? 'pending'
            : 'failed',
      });

      // Update policy tracking
      await this.updatePolicyTracking(policy.id, updateInfo.latestVersion);

      return {
        success: true,
        packagingJobId: packagingJob.id,
        historyId: historyRecord.id,
        packageProfileSha256: qaDemand.identity.executionProfileSha256,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Increment failure counter
      await this.incrementFailureCount(policy.id);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Check rate limits for auto-updates
   */
  private async checkRateLimits(userId: string, tenantId: string, policyId: string): Promise<RateLimitCheck> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { rateLimits } = this.safetyConfig;

    // First, get the policy IDs for this tenant
    const { data: tenantPolicies } = await this.supabase
      .from('app_update_policies')
      .select('id')
      .eq('tenant_id', tenantId);

    if (tenantPolicies && tenantPolicies.length > 0) {
      const tenantPolicyIds = tenantPolicies.map((p) => p.id);

      // Check per-tenant rate limit
      const { count: tenantCount } = await this.supabase
        .from('auto_update_history')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('triggered_at', oneHourAgo)
        .in('policy_id', tenantPolicyIds);

      if (tenantCount && tenantCount >= rateLimits.maxUpdatesPerTenant) {
        return {
          allowed: false,
          reason: `Rate limit exceeded: ${rateLimits.maxUpdatesPerTenant} updates per tenant per hour`,
          retryAfterMinutes: 60,
        };
      }
    }

    // Get policy IDs for this user
    const { data: userPolicies } = await this.supabase
      .from('app_update_policies')
      .select('id')
      .eq('user_id', userId);

    if (userPolicies && userPolicies.length > 0) {
      const userPolicyIds = userPolicies.map((p) => p.id);

      // Check global hourly rate limit
      const { count: globalCount } = await this.supabase
        .from('auto_update_history')
        .select('id', { count: 'exact', head: true })
        .gte('triggered_at', oneHourAgo)
        .in('policy_id', userPolicyIds);

      if (globalCount && globalCount >= rateLimits.maxUpdatesPerHour) {
        return {
          allowed: false,
          reason: `Rate limit exceeded: ${rateLimits.maxUpdatesPerHour} updates per hour`,
          retryAfterMinutes: 60,
        };
      }
    }

    // Check cooldown since last update for this specific policy
    const cooldownTime = new Date(
      Date.now() - rateLimits.cooldownMinutes * 60 * 1000
    ).toISOString();

    const { data: recentUpdate } = await this.supabase
      .from('auto_update_history')
      .select('id')
      .eq('policy_id', policyId)
      .gte('triggered_at', cooldownTime)
      .limit(1);

    if (recentUpdate && recentUpdate.length > 0) {
      return {
        allowed: false,
        reason: `Cooldown period: wait ${rateLimits.cooldownMinutes} minutes between updates`,
        retryAfterMinutes: rateLimits.cooldownMinutes,
      };
    }

    return { allowed: true };
  }

  /**
   * Verify tenant consent is still active
   */
  private async verifyTenantConsent(tenantId: string): Promise<boolean> {
    const { data: consent } = await this.supabase
      .from('tenant_consent')
      .select('is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    return !!consent;
  }

  /**
   * Create auto-update history record
   */
  private async createHistoryRecord(
    policyId: string,
    updateInfo: UpdateInfo,
    updateType: 'patch' | 'minor' | 'major'
  ): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .from('auto_update_history')
      .insert({
        policy_id: policyId,
        from_version: updateInfo.currentVersion,
        to_version: updateInfo.latestVersion,
        update_type: updateType,
        status: 'pending',
        triggered_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to create history record: ${error.message}`);
    }

    return data;
  }

  /**
   * Update auto-update history record
   */
  private async updateHistoryRecord(
    historyId: string,
    updates: Partial<AutoUpdateHistory>
  ): Promise<void> {
    const { error } = await this.supabase
      .from('auto_update_history')
      .update(updates)
      .eq('id', historyId);

    if (error) {
      console.error('Failed to update history record:', error);
    }
  }

  /**
   * Read the user's current global update settings (carryOverAssignments
   * and supersedePreviousApp). These are the single source of truth, not
   * the stored policy values.
   */
  private async getUserUpdateSettings(
    userId: string
  ): Promise<{ carryOverAssignments: boolean; supersedePreviousApp: boolean }> {
    const { data, error } = await this.supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.warn(
        `Failed to read user_settings for ${userId}: ${error.message}`
      );
      return { carryOverAssignments: false, supersedePreviousApp: false };
    }

    const settings = data?.settings as Record<string, unknown> | null;
    return {
      carryOverAssignments: Boolean(settings?.carryOverAssignments),
      supersedePreviousApp: Boolean(settings?.supersedePreviousApp),
    };
  }

  /**
   * Ensure deployment_config carries the PSADT settings from the original
   * deployment. Policies created before psadtConfig was persisted lack it;
   * read it from the most recent packaging job for this app and store it
   * back on the policy so per-package settings (deploy mode, command
   * overrides, verifyInstall, removeExistingInstall, registryMarkerPath)
   * survive updates. Mutates policy.deployment_config in place; failures
   * are non-fatal (the update proceeds without PSADT settings, as before).
   */
  private async ensurePsadtConfig(policy: AppUpdatePolicy): Promise<void> {
    const config = policy.deployment_config as DeploymentConfig | null;
    if (!config || config.psadtConfig) {
      return;
    }

    try {
      const { data: uploadHistory } = await this.supabase
        .from('upload_history')
        .select('packaging_job_id')
        .eq('user_id', policy.user_id)
        .eq('intune_tenant_id', policy.tenant_id)
        .eq('winget_id', policy.winget_id)
        .not('packaging_job_id', 'is', null)
        .order('deployed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!uploadHistory?.packaging_job_id) {
        return;
      }

      const { data: packagingJob } = await this.supabase
        .from('packaging_jobs')
        .select('package_config')
        .eq('id', uploadHistory.packaging_job_id)
        .maybeSingle();

      const packageConfig = packagingJob?.package_config;
      if (
        !packageConfig ||
        typeof packageConfig !== 'object' ||
        Array.isArray(packageConfig)
      ) {
        return;
      }

      const psadtConfig = (packageConfig as Record<string, unknown>).psadtConfig;
      if (!psadtConfig || typeof psadtConfig !== 'object' || Array.isArray(psadtConfig)) {
        return;
      }

      config.psadtConfig = psadtConfig as DeploymentConfig['psadtConfig'];

      await this.supabase
        .from('app_update_policies')
        .update({ deployment_config: policy.deployment_config })
        .eq('id', policy.id);
    } catch (error) {
      console.warn(
        `Could not backfill psadtConfig for policy ${policy.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async ensureCurrentPackageDefaults(
    policy: AppUpdatePolicy,
    updateInfo: UpdateInfo
  ): Promise<void> {
    const current = policy.deployment_config as DeploymentConfig | null;
    if (!current) return;

    const upgraded = upgradeLegacyPackageDefaults(current, {
      wingetId: updateInfo.wingetId,
      version: updateInfo.latestVersion,
      displayName: updateInfo.displayName,
      installerUrl: updateInfo.installerUrl,
      installerSha256: updateInfo.installerSha256,
      installerType: updateInfo.installerType || current.installerType,
      installScope: updateInfo.installScope ||
        (current.installScope === 'user' ? 'user' : 'machine'),
    });
    if (!upgraded.changed) return;

    const { error } = await this.supabase
      .from('app_update_policies')
      .update({
        deployment_config: upgraded.config,
        updated_at: new Date().toISOString(),
      })
      .eq('id', policy.id);
    if (error) {
      throw new Error(`Could not persist corrected package defaults: ${error.message}`);
    }
    policy.deployment_config = upgraded.config;
  }

  /**
   * Create a packaging job for the update
   */
  private async createPackagingJob(
    policy: AppUpdatePolicy,
    updateInfo: UpdateInfo,
    historyId: string,
    qaDemand?: QaDemandResult
  ): Promise<{ id: string }> {
    const config = policy.deployment_config as DeploymentConfig;
    const assignments = normalizeAssignments(config);
    const categories = normalizeCategories(config);

    // Always re-read the user's current global settings instead of trusting
    // the stored policy values, which may be stale if the user toggled the
    // settings after the policy was created.
    const { carryOverAssignments: globalCarryOver, supersedePreviousApp } =
      await this.getUserUpdateSettings(policy.user_id);
    const assignmentMigration = {
      carryOverAssignments: globalCarryOver,
      removeAssignmentsFromPreviousApp: globalCarryOver,
    };
    const sourceIntuneAppId = updateInfo.currentIntuneAppId || null;
    const autoSupersede = supersedePreviousApp && Boolean(sourceIntuneAppId);

    // Get user email for the job
    const { data: userProfile } = await this.supabase
      .from('user_profiles')
      .select('email')
      .eq('id', policy.user_id)
      .single();

    const jobData = {
      user_id: policy.user_id,
      user_email: userProfile?.email || null,
      tenant_id: policy.tenant_id,
      winget_id: updateInfo.wingetId,
      version: updateInfo.latestVersion,
      display_name: config.displayName || updateInfo.displayName,
      publisher: config.publisher,
      architecture: config.architecture,
      installer_type: updateInfo.installerType || config.installerType,
      installer_url: updateInfo.installerUrl,
      installer_sha256: updateInfo.installerSha256,
      // Refresh vendor-controlled installer arguments for each version. A
      // user-supplied psadtConfig.installCommand is kept in package_config and
      // still takes precedence inside the packager.
      install_command: updateInfo.installCommand || config.installCommand,
      uninstall_command: config.uninstallCommand,
      install_scope: updateInfo.installScope || config.installScope,
      detection_rules: config.detectionRules,
      package_config: {
        assignments,
        categories,
        assignedGroups: config.assignedGroups,
        requirementRules: config.requirementRules,
        // App relationships (dependencies/supersedence) from the original
        // deployment are read from package_config by the packager
        relationships: config.relationships,
        // PSADT settings and nested installer info are read from
        // package_config by the local packager (job-processor.ts)
        psadtConfig: config.psadtConfig,
        nestedInstallerType: updateInfo.nestedInstallerType,
        nestedInstallerPath: updateInfo.nestedInstallerPath,
        installerSuccessCodes: updateInfo.installerSuccessCodes,
        forceCreate: config.forceCreateNewApp !== false,
        sourceIntuneAppId,
        autoSupersede,
        supersedenceType: autoSupersede ? 'update' : undefined,
        assignmentMigration: {
          carryOverAssignments: Boolean(assignmentMigration.carryOverAssignments),
          removeAssignmentsFromPreviousApp: Boolean(
            assignmentMigration.removeAssignmentsFromPreviousApp
          ),
        },
        description: config.description,
        notes: config.notes,
        autoUpdateHistoryId: historyId,
      },
      status: !qaDemand || qaDemand.state === 'passed'
        ? 'queued'
        : qaDemand.state === 'waiting'
          ? 'awaiting_qa'
          : 'qa_failed',
      status_message: !qaDemand || qaDemand.state === 'passed'
        ? 'Installation test passed; preparing deployment'
        : qaDemand.state === 'waiting'
          ? 'Running an isolated installation test to make sure this app works before deployment'
          : qaDemand.failureSummary || 'This app did not pass the isolated installation test',
      progress_percent: 0,
      execution_profile_sha256: qaDemand?.identity.executionProfileSha256 || null,
      presentation_profile_sha256: qaDemand?.identity.presentationProfileSha256 || null,
      qa_candidate_id: qaDemand?.candidateId || null,
      qa_requested_at: qaDemand ? new Date().toISOString() : null,
      qa_completed_at: !qaDemand || qaDemand.state === 'waiting' ? null : new Date().toISOString(),
      is_auto_update: true,
      auto_update_policy_id: policy.id,
    };

    const { data, error } = await this.supabase
      .from('packaging_jobs')
      .insert(jobData)
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to create packaging job: ${error.message}`);
    }

    return data;
  }

  /**
   * Update policy tracking after triggering update
   */
  private async updatePolicyTracking(
    policyId: string,
    newVersion: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('app_update_policies')
      .update({
        last_auto_update_at: new Date().toISOString(),
        last_auto_update_version: newVersion,
        consecutive_failures: 0, // Reset on successful trigger
        updated_at: new Date().toISOString(),
      })
      .eq('id', policyId);

    if (error) {
      console.error('Failed to update policy tracking:', error);
    }
  }

  /**
   * Increment failure count for circuit breaker
   */
  private async incrementFailureCount(policyId: string): Promise<void> {
    // Get current failure count
    const { data: policy } = await this.supabase
      .from('app_update_policies')
      .select('consecutive_failures')
      .eq('id', policyId)
      .single();

    const newCount = (policy?.consecutive_failures || 0) + 1;
    const shouldDisable = newCount >= this.safetyConfig.maxConsecutiveFailures;

    const updates: Record<string, unknown> = {
      consecutive_failures: newCount,
      updated_at: new Date().toISOString(),
    };

    // Disable policy if circuit breaker threshold reached
    if (shouldDisable) {
      updates.is_enabled = false;
      console.warn(`Circuit breaker triggered for policy ${policyId}: disabled after ${newCount} consecutive failures`);
    }

    const { error } = await this.supabase
      .from('app_update_policies')
      .update(updates)
      .eq('id', policyId);

    if (error) {
      console.error('Failed to update failure count:', error);
    }
  }

  /**
   * Mark an auto-update as completed
   */
  async markUpdateCompleted(historyId: string, packagingJobId: string): Promise<void> {
    const { error } = await this.supabase
      .from('auto_update_history')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', historyId);

    if (error) {
      console.error('Failed to mark update as completed:', error);
    }
  }

  /**
   * Mark an auto-update as failed
   */
  async markUpdateFailed(historyId: string, errorMessage: string): Promise<void> {
    const { error } = await this.supabase
      .from('auto_update_history')
      .update({
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })
      .eq('id', historyId);

    if (error) {
      console.error('Failed to mark update as failed:', error);
    }
  }

  /**
   * Get policies eligible for auto-update
   */
  async getEligiblePolicies(userId?: string, tenantId?: string): Promise<AppUpdatePolicy[]> {
    let query = this.supabase
      .from('app_update_policies')
      .select('*')
      .eq('policy_type', 'auto_update')
      .eq('is_enabled', true)
      .lt('consecutive_failures', this.safetyConfig.maxConsecutiveFailures);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch eligible policies:', error);
      return [];
    }

    return data || [];
  }
}

/**
 * Create a singleton instance for use in API routes
 */
export function createAutoUpdateTrigger(): AutoUpdateTrigger | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase configuration for auto-update trigger');
    return null;
  }

  return new AutoUpdateTrigger(supabaseUrl, supabaseServiceKey);
}

/**
 * Get installer info from curated_apps and version_history
 */
export async function getLatestInstallerInfo(
  // Kept for call-site compatibility; the catalog source owns client creation.
  _supabase: SupabaseClient,
  wingetId: string,
  architecture?: string,
  installScope?: string
): Promise<UpdateInfo | null> {
  const catalog = getCatalogSource();

  // Get the curated app info
  const curatedApp = await catalog.getAppForInstaller(wingetId);

  if (!curatedApp?.latest_version) {
    return null;
  }

  // Get the version history for the latest version
  const versionInfo = await catalog.getVersionInstallerInfo(
    wingetId,
    curatedApp.latest_version
  );

  if (!versionInfo) {
    return null;
  }

  // Bind the selected installer to the deployment's requested architecture.
  let installerUrl = versionInfo.installer_url;
  let installerSha256 = versionInfo.installer_sha256;
  let installerType = versionInfo.installer_type;
  let nestedInstallerType: string | undefined;
  let nestedInstallerPath: string | undefined;
  let selectedManifestInstaller: WingetInstaller | null = null;

  // The installers JSONB uses PascalCase from WinGet manifests.
  if (versionInfo.installers && Array.isArray(versionInfo.installers)) {
    const requestedScope = installScope === undefined
      ? undefined
      : resolveApplicationInstallScope(wingetId, installScope);
    const selectedInstaller = selectWingetInstaller(
      versionInfo.installers,
      architecture,
      requestedScope
    );
    if (!selectedInstaller) return null;
    installerUrl = selectedInstaller.InstallerUrl || installerUrl;
    installerSha256 = selectedInstaller.InstallerSha256 || installerSha256;
    installerType = selectedInstaller.InstallerType || installerType;
    nestedInstallerType = selectedInstaller.NestedInstallerType || undefined;
    nestedInstallerPath = Array.isArray(selectedInstaller.NestedInstallerFiles)
      ? selectedInstaller.NestedInstallerFiles[0]?.RelativeFilePath
      : undefined;
    selectedManifestInstaller = selectedInstaller as WingetInstaller;
  } else if (architecture) {
    return null;
  }

  const normalizedSha256 = normalizeInstallerSha256(installerSha256);
  if (!installerUrl || !normalizedSha256) {
    return null;
  }

  const manifestInstaller = {
    ...(selectedManifestInstaller || {}),
    Architecture: (selectedManifestInstaller?.Architecture || architecture || 'x64'),
    InstallerUrl: installerUrl,
    InstallerSha256: normalizedSha256,
    InstallerType: (installerType || 'exe'),
    NestedInstallerType: selectedManifestInstaller?.NestedInstallerType || nestedInstallerType,
    NestedInstallerFiles: selectedManifestInstaller?.NestedInstallerFiles ||
      (nestedInstallerPath ? [{ RelativeFilePath: nestedInstallerPath }] : undefined),
    Scope: selectedManifestInstaller?.Scope || versionInfo.installer_scope || undefined,
    // Current snapshots keep the manifest-level Silent value in silent_args
    // and installer-level overrides (for example Custom) in each installer.
    // Merge them per field just like a freshly fetched WinGet manifest.
    InstallerSwitches: {
      ...(versionInfo.silent_args ? { Silent: versionInfo.silent_args } : {}),
      ...(selectedManifestInstaller?.InstallerSwitches || {}),
    },
  } as WingetInstaller;
  const normalizedInstaller = normalizeInstaller(manifestInstaller);

  return {
    wingetId,
    currentVersion: '', // Will be filled by caller
    latestVersion: curatedApp.latest_version,
    displayName: curatedApp.name,
    installerUrl,
    installerSha256: normalizedSha256,
    installerType: installerType || 'exe',
    installCommand: buildCurrentVersionInstallCommand(normalizedInstaller),
    silentSwitches: normalizedInstaller.silentArgs,
    installerSuccessCodes: normalizedInstaller.installerSuccessCodes,
    installScope: normalizedInstaller.scope,
    nestedInstallerType,
    nestedInstallerPath,
  };
}
