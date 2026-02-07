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
import type { PackageAssignment } from '@/types/upload';

interface TriggerResult {
  success: boolean;
  packagingJobId?: string;
  historyId?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

interface UpdateInfo {
  wingetId: string;
  currentVersion: string;
  latestVersion: string;
  displayName: string;
  installerUrl: string;
  installerSha256: string;
  installerType: string;
  currentIntuneAppId?: string;
}

interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
  retryAfterMinutes?: number;
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
    updateInfo: UpdateInfo
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
      if (this.safetyConfig.requirePriorDeployment && !policy.original_upload_history_id) {
        return {
          success: false,
          error: 'Auto-update requires a prior manual deployment',
        };
      }

      // Safety check 4: Check rate limits
      const rateLimitResult = await this.checkRateLimits(policy.user_id, policy.tenant_id);
      if (!rateLimitResult.allowed) {
        return {
          success: false,
          skipped: true,
          skipReason: rateLimitResult.reason,
        };
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

      // Determine update type
      const updateType = classifyUpdateType(updateInfo.currentVersion, updateInfo.latestVersion);

      // Create auto-update history record
      const historyRecord = await this.createHistoryRecord(policy.id, updateInfo, updateType);

      // Create packaging job
      const packagingJob = await this.createPackagingJob(
        policy,
        updateInfo,
        historyRecord.id
      );

      // Update history with job reference
      await this.updateHistoryRecord(historyRecord.id, {
        packaging_job_id: packagingJob.id,
        status: 'packaging',
      });

      // Update policy tracking
      await this.updatePolicyTracking(policy.id, updateInfo.latestVersion);

      return {
        success: true,
        packagingJobId: packagingJob.id,
        historyId: historyRecord.id,
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
  private async checkRateLimits(userId: string, tenantId: string): Promise<RateLimitCheck> {
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
   * Create a packaging job for the update
   */
  private async createPackagingJob(
    policy: AppUpdatePolicy,
    updateInfo: UpdateInfo,
    historyId: string
  ): Promise<{ id: string }> {
    const config = policy.deployment_config as DeploymentConfig;
    const assignments = normalizeAssignments(config);
    const assignmentMigration = config.assignmentMigration || {
      carryOverAssignments: false,
      removeAssignmentsFromPreviousApp: false,
    };
    const sourceIntuneAppId = updateInfo.currentIntuneAppId || null;

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
      install_command: config.installCommand,
      uninstall_command: config.uninstallCommand,
      install_scope: config.installScope,
      detection_rules: config.detectionRules,
      package_config: {
        assignments,
        assignedGroups: config.assignedGroups,
        forceCreate: config.forceCreateNewApp !== false,
        sourceIntuneAppId,
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
      status: 'queued',
      progress_percent: 0,
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
  supabase: SupabaseClient,
  wingetId: string
): Promise<UpdateInfo | null> {
  // Get the curated app info
  const { data: curatedApp, error: appError } = await supabase
    .from('curated_apps')
    .select('winget_id, name, latest_version')
    .eq('winget_id', wingetId)
    .single();

  if (appError || !curatedApp?.latest_version) {
    return null;
  }

  // Get the version history for the latest version
  const { data: versionInfo, error: versionError } = await supabase
    .from('version_history')
    .select('installer_url, installer_sha256, installer_type, installers')
    .eq('winget_id', wingetId)
    .eq('version', curatedApp.latest_version)
    .single();

  if (versionError || !versionInfo) {
    return null;
  }

  // Extract installer details (prefer x64 architecture)
  let installerUrl = versionInfo.installer_url;
  let installerSha256 = versionInfo.installer_sha256;
  let installerType = versionInfo.installer_type;

  // If there are architecture-specific installers, prefer x64
  // Note: The installers JSONB uses PascalCase from winget manifests
  if (versionInfo.installers && Array.isArray(versionInfo.installers)) {
    const x64Installer = versionInfo.installers.find(
      (i: { Architecture?: string }) => i.Architecture === 'x64'
    );
    if (x64Installer) {
      installerUrl = x64Installer.InstallerUrl || installerUrl;
      installerSha256 = x64Installer.InstallerSha256 || installerSha256;
      installerType = x64Installer.InstallerType || installerType;
    }
  }

  if (!installerUrl) {
    return null;
  }

  return {
    wingetId,
    currentVersion: '', // Will be filled by caller
    latestVersion: curatedApp.latest_version,
    displayName: curatedApp.name,
    installerUrl,
    installerSha256: installerSha256 || '',
    installerType: installerType || 'exe',
  };
}
