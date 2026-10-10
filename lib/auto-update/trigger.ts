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
import { isCuratedPackageId } from '@/lib/curated-catalog/core.mjs';
import { assertCuratedInstaller, authorizeCuratedWorkflow, getApprovedCuratedRelease } from '@/lib/curated-catalog/server';
import { CuratedConfigVerificationError } from '@/lib/curated-catalog/custom-config';
import { buildCuratedCartItem, curatedWorkflowInput } from '@/lib/curated-catalog/package';
import { testedCuratedSettings } from '@/lib/curated-catalog/settings';
import { assertCuratedLicenceAccepted, CuratedLicenceError } from '@/lib/curated-catalog/licence';
import type { CuratedLicenceAcceptanceSnapshot } from '@/lib/curated-catalog/types';
import {
  normalizeInstallerSha256,
  selectWingetInstaller,
} from '@/lib/qa/candidate';
import { ensureQaDemand, type QaDemandResult } from '@/lib/qa/demand';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import {
  generateDetectionRules,
  generateInstallCommand,
  generateUninstallCommand,
} from '@/lib/detection-rules';
import { normalizeInstaller } from '@/lib/manifest-api';
import { upgradeLegacyPackageDefaults } from '@/lib/update-policies/upgrade-legacy-package-defaults';
import {
  applyApplicationPackagingAdapter,
  resolveApplicationInstallScope,
} from '@/lib/packaging-adapters';
import type { NormalizedInstaller, WingetInstaller, WingetScope } from '@/types/winget';
import { DEFAULT_PSADT_CONFIG, type DetectionRule } from '@/types/psadt';
import { QA_PRIORITY_DEMAND } from '@/lib/qa/constants';

interface TriggerResult {
  success: boolean;
  packagingJobId?: string;
  historyId?: string;
  packageProfileSha256?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
  code?:
    | 'QA_FAILED_CURRENT_VERSION'
    | 'QA_NOT_PASSED_CURRENT_VERSION'
    | 'QA_SECURITY_FLAGGED_CURRENT_VERSION'
    | 'QA_PACKAGE_COMPATIBILITY_BLOCKED'
    | 'CURATED_LICENCE_NOT_ACCEPTED'
    | 'CURATED_CONFIG_VERIFICATION_REQUIRED'
    | 'CURATED_CONFIG_VERIFICATION_FAILED'
    | 'RATE_LIMIT_UNVERIFIED';
}

export interface UpdateInfo {
  sourceType?: 'curated';
  curatedReleaseId?: string;
  curatedLicenceAcceptance?: CuratedLicenceAcceptanceSnapshot;
  wingetId: string;
  currentVersion: string;
  latestVersion: string;
  displayName: string;
  installerUrl: string;
  installerSha256: string;
  installerType: string;
  installCommand?: string;
  uninstallCommand?: string;
  detectionRules?: DetectionRule[];
  silentSwitches?: string;
  installerSuccessCodes?: number[];
  installScope?: WingetScope;
  nestedInstallerType?: string;
  nestedInstallerPath?: string;
  currentIntuneAppId?: string;
}

export type InstallerResolutionFailureReason =
  | 'curated_release_unavailable'
  | 'app_not_in_catalog'
  | 'version_record_missing'
  | 'installer_metadata_missing'
  | 'no_compatible_installer'
  | 'installer_url_missing'
  | 'installer_hash_invalid';

export interface InstallerResolutionFailure {
  reason: InstallerResolutionFailureReason;
  /** Human-readable, user-facing message with app/version/arch/scope context. */
  message: string;
}

export type InstallerResolutionResult =
  | { ok: true; info: UpdateInfo }
  | { ok: false; failure: InstallerResolutionFailure };

interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
  retryAfterMinutes?: number;
  // Set when a read failed, so callers can report it instead of treating it
  // as an ordinary skip.
  code?: 'RATE_LIMIT_UNVERIFIED';
}

type RecentUpdateCount = { count: number } | { count: null; error: string };

function readErrorMessage(error: unknown): string {
  if (error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return 'no data returned';
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

// Rate limit reads: keyset page size for policy ids, and how many ids go into
// one `policy_id=in.(...)` count so the request stays inside URL limits.
const RATE_LIMIT_PAGE_SIZE = 1000;
const RATE_LIMIT_ID_CHUNK_SIZE = 100;

/**
 * Main service for triggering auto-updates
 */
export class AutoUpdateTrigger {
  private supabase: SupabaseClient;
  private safetyConfig: AutoUpdateSafetyConfig;
  // Per instance (one cron run or one request) rate limit state, so many
  // candidates in one run do not rescan the same policy lists. Policy ids
  // hardly change within a run, and a scope at its limit stays there for the
  // few minutes a run takes, because the counted window is one hour.
  private ratePolicyIds = new Map<string, string[]>();
  private rateLimitedScopes = new Map<string, RateLimitCheck>();

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

      // Custom detection belongs to the administrator and stays fixed until edited.
      if (policy.deployment_config.psadtConfig?.customDetection) {
        return { success: false, skipped: true, skipReason: customDetectionUpdateHold(updateInfo.latestVersion) };
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
            code: rateLimitResult.code,
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
      if (policy.deployment_config.psadtConfig?.customDetection) {
        return { success: false, skipped: true, skipReason: customDetectionUpdateHold(updateInfo.latestVersion) };
      }

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
      let deploymentConfig: DeploymentConfig = {
        ...storedDeploymentConfig,
        installScope: effectiveInstallScope,
        uninstallCommand:
          updateInfo.uninstallCommand || storedDeploymentConfig.uninstallCommand,
        detectionRules:
          updateInfo.detectionRules || storedDeploymentConfig.detectionRules,
        psadtConfig: applyApplicationPackagingAdapter(
          updateInfo.wingetId,
          storedDeploymentConfig.psadtConfig || DEFAULT_PSADT_CONFIG
        ),
      };
      if (isCuratedPackageId(updateInfo.wingetId)) {
        const approved = assertCuratedInstaller({
          wingetId: updateInfo.wingetId, version: updateInfo.latestVersion,
          architecture: deploymentConfig.architecture, installScope: effectiveInstallScope,
          installerUrl: updateInfo.installerUrl, installerSha256: updateInfo.installerSha256,
          installerType: updateInfo.installerType, curatedReleaseId: updateInfo.curatedReleaseId,
        });
        const current = buildCuratedCartItem(approved.app, approved.release);
        deploymentConfig = {
          ...deploymentConfig, sourceType: 'curated', curatedReleaseId: approved.release.id,
          displayName: current.displayName, publisher: current.publisher,
          architecture: current.architecture, installScope: current.installScope,
          installerType: current.installerType, installCommand: current.installCommand,
          uninstallCommand: current.uninstallCommand, detectionRules: current.detectionRules,
          // Keep the tenant's PSADT settings. Custom execution settings must be
          // verified for this release; until then the update waits (queued for
          // verification) without counting a failure.
          psadtConfig: deploymentConfig.curatedSettingsMode === 'tested-defaults'
            ? testedCuratedSettings(current.psadtConfig, deploymentConfig.psadtConfig || current.psadtConfig)
            : deploymentConfig.psadtConfig || current.psadtConfig,
        };
        try {
          await authorizeCuratedWorkflow({
            ...curatedWorkflowInput({ ...current, psadtConfig: deploymentConfig.psadtConfig || current.psadtConfig }),
            installerUrl: current.installerUrl, curatedReleaseId: approved.release.id,
          }, { tenantId: policy.tenant_id, userId: policy.user_id });
        } catch (error) {
          if (!(error instanceof CuratedConfigVerificationError)) throw error;
          return { success: false, skipped: true, skipReason: error.message, code: error.verificationCode };
        }
        updateInfo = { ...updateInfo, sourceType: 'curated', curatedReleaseId: approved.release.id };
        // Automatic updates never imply licence acceptance: skip (without
        // counting a failure) until the tenant accepts the current agreement.
        try {
          const acceptance = await assertCuratedLicenceAccepted(policy.tenant_id, approved.app.packageId);
          if (acceptance) updateInfo = { ...updateInfo, curatedLicenceAcceptance: acceptance };
        } catch (error) {
          if (!(error instanceof CuratedLicenceError)) throw error;
          return { success: false, skipped: true, skipReason: error.message, code: error.code };
        }
      }
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
        uninstallCommand: updateInfo.uninstallCommand || deploymentConfig.uninstallCommand || '',
        installScope: updateInfo.installScope ||
          (deploymentConfig.installScope === 'user' ? 'user' : 'machine'),
        psadtConfig: deploymentConfig.psadtConfig
          ? JSON.stringify(deploymentConfig.psadtConfig)
          : undefined,
        detectionRules: JSON.stringify(
          updateInfo.detectionRules || deploymentConfig.detectionRules || []
        ),
        priority: QA_PRIORITY_DEMAND,
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
   * Count auto-update history rows since `since` for every policy of one
   * tenant or one user. Policy ids are read with keyset paging and counted in
   * small chunks, so a large policy list cannot exceed URL limits. Returns
   * the read error when any read fails, so callers can fail closed and say why.
   */
  private async countRecentUpdates(
    scope: { column: 'tenant_id' | 'user_id'; value: string },
    since: string,
    completedOnly: boolean
  ): Promise<RecentUpdateCount> {
    const scopeKey = `${scope.column}:${scope.value}`;
    const cachedIds = this.ratePolicyIds.get(scopeKey);
    const policyIds: string[] = cachedIds ? [...cachedIds] : [];
    let afterId: string | null = null;
    while (!cachedIds) {
      const query = this.supabase
        .from('app_update_policies')
        .select('id')
        .eq(scope.column, scope.value);
      const page: { data: Array<{ id: unknown }> | null; error: unknown } = await (afterId
        ? query.gt('id', afterId)
        : query
      )
        .order('id')
        .limit(RATE_LIMIT_PAGE_SIZE);
      const { data, error } = page;
      if (error || !data) {
        return { count: null, error: `policy read failed: ${readErrorMessage(error)}` };
      }
      if (data.length === 0) {
        this.ratePolicyIds.set(scopeKey, [...policyIds]);
        break;
      }
      const lastId: unknown = data[data.length - 1].id;
      if (typeof lastId !== 'string' || lastId === afterId) {
        return { count: null, error: 'policy read did not return an advancing id' };
      }
      policyIds.push(...data.map((row) => String(row.id)));
      afterId = lastId;
    }

    let total = 0;
    for (let start = 0; start < policyIds.length; start += RATE_LIMIT_ID_CHUNK_SIZE) {
      let query = this.supabase
        .from('auto_update_history')
        .select('id', { count: 'exact', head: true })
        .gte('triggered_at', since)
        .in('policy_id', policyIds.slice(start, start + RATE_LIMIT_ID_CHUNK_SIZE));
      if (completedOnly) {
        query = query.eq('status', 'completed');
      }
      const { count, error } = await query;
      if (error || typeof count !== 'number') {
        return { count: null, error: `update count failed: ${readErrorMessage(error)}` };
      }
      total += count;
    }
    return { count: total };
  }

  /**
   * Check rate limits for auto-updates. A count that cannot be read counts as
   * a reached limit, so a failed or oversized query never lets updates through.
   */
  private async checkRateLimits(userId: string, tenantId: string, policyId: string): Promise<RateLimitCheck> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { rateLimits } = this.safetyConfig;
    const unverified = (error: string): RateLimitCheck => ({
      allowed: false,
      reason: `Rate limit could not be verified (${error}), the update will be retried later`,
      retryAfterMinutes: rateLimits.cooldownMinutes,
      code: 'RATE_LIMIT_UNVERIFIED',
    });

    const tenantScope = `tenant_id:${tenantId}`;
    const userScope = `user_id:${userId}`;
    const limited = this.rateLimitedScopes.get(tenantScope) ?? this.rateLimitedScopes.get(userScope);
    if (limited) {
      return limited;
    }

    // Check per-tenant rate limit
    const tenantCount = await this.countRecentUpdates(
      { column: 'tenant_id', value: tenantId },
      oneHourAgo,
      true
    );
    if (tenantCount.count === null) {
      return unverified(tenantCount.error);
    }
    if (tenantCount.count >= rateLimits.maxUpdatesPerTenant) {
      const denial: RateLimitCheck = {
        allowed: false,
        reason: `Rate limit exceeded: ${rateLimits.maxUpdatesPerTenant} updates per tenant per hour`,
        retryAfterMinutes: 60,
      };
      this.rateLimitedScopes.set(tenantScope, denial);
      return denial;
    }

    // Check global hourly rate limit for this user
    const userCount = await this.countRecentUpdates(
      { column: 'user_id', value: userId },
      oneHourAgo,
      false
    );
    if (userCount.count === null) {
      return unverified(userCount.error);
    }
    if (userCount.count >= rateLimits.maxUpdatesPerHour) {
      const denial: RateLimitCheck = {
        allowed: false,
        reason: `Rate limit exceeded: ${rateLimits.maxUpdatesPerHour} updates per hour`,
        retryAfterMinutes: 60,
      };
      this.rateLimitedScopes.set(userScope, denial);
      return denial;
    }

    // Check cooldown since last update for this specific policy
    const cooldownTime = new Date(
      Date.now() - rateLimits.cooldownMinutes * 60 * 1000
    ).toISOString();

    const { data: recentUpdate, error: recentUpdateError } = await this.supabase
      .from('auto_update_history')
      .select('id')
      .eq('policy_id', policyId)
      .gte('triggered_at', cooldownTime)
      .limit(1);

    if (recentUpdateError) {
      return unverified(`cooldown read failed: ${readErrorMessage(recentUpdateError)}`);
    }

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

    // Re-read the user's current global settings so policies without an
    // explicit per-app choice follow the settings toggle live. An explicit
    // assignmentMigration on the policy config (set via the deployment
    // flow's App Updates checkbox) wins over the global value.
    const { carryOverAssignments: globalCarryOver, supersedePreviousApp } =
      await this.getUserUpdateSettings(policy.user_id);
    const assignmentMigration = config.assignmentMigration ?? {
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
        sourceType: updateInfo.sourceType || config.sourceType,
        curatedReleaseId: updateInfo.curatedReleaseId,
        curatedSettingsMode: config.curatedSettingsMode,
        curatedLicenceAcceptance: updateInfo.curatedLicenceAcceptance,
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
): Promise<InstallerResolutionResult> {
  if (isCuratedPackageId(wingetId)) {
    try {
      const { app, release } = getApprovedCuratedRelease(wingetId);
      if ((architecture && architecture !== app.architecture) || (installScope && installScope !== app.scope)) {
        throw new Error('The curated pilot supports x64 machine installations.');
      }
      const item = buildCuratedCartItem(app, release);
      return { ok: true, info: {
        wingetId: app.packageId, currentVersion: '', latestVersion: item.version,
        displayName: item.displayName, installerUrl: item.installerUrl,
        installerSha256: item.installerSha256, installerType: item.installerType,
        installCommand: item.installCommand, uninstallCommand: item.uninstallCommand,
        detectionRules: item.detectionRules, silentSwitches: app.silentArgs,
        installScope: app.scope, sourceType: 'curated', curatedReleaseId: release.id,
      } };
    } catch {
      return { ok: false, failure: { reason: 'curated_release_unavailable',
        message: 'No approved curated release is available for this application and installation configuration.' } };
    }
  }
  const catalog = getCatalogSource();

  // Get the curated app info
  const curatedApp = await catalog.getAppForInstaller(wingetId);

  if (!curatedApp) {
    return {
      ok: false,
      failure: {
        reason: 'app_not_in_catalog',
        message: `${wingetId} is not in the app catalog, so an update cannot be packaged for it.`,
      },
    };
  }

  if (!curatedApp.latest_version) {
    return {
      ok: false,
      failure: {
        reason: 'version_record_missing',
        message: `The catalog has no latest version recorded for ${wingetId} yet. Try again after the next catalog sync.`,
      },
    };
  }

  const latestVersion = curatedApp.latest_version;

  // Get the version history for the latest version
  const versionInfo = await catalog.getVersionInstallerInfo(
    wingetId,
    latestVersion
  );

  if (!versionInfo) {
    return {
      ok: false,
      failure: {
        reason: 'version_record_missing',
        message: `The catalog has not synced the installer manifest for ${wingetId} ${latestVersion} yet. Try again after the next catalog sync.`,
      },
    };
  }

  // Bind the selected installer to the deployment's requested architecture.
  let installerUrl = versionInfo.installer_url;
  let installerSha256 = versionInfo.installer_sha256;
  let installerType = versionInfo.installer_type;
  let nestedInstallerType: string | undefined;
  let nestedInstallerPath: string | undefined;
  let selectedManifestInstaller: WingetInstaller | null = null;
  const requestedScope = installScope === undefined
    ? undefined
    : resolveApplicationInstallScope(wingetId, installScope);

  // The installers JSONB uses PascalCase from WinGet manifests.
  if (Array.isArray(versionInfo.installers) && versionInfo.installers.length > 0) {
    const selectedInstaller = selectWingetInstaller(
      versionInfo.installers,
      architecture,
      requestedScope,
      wingetId,
    );
    if (!selectedInstaller) {
      return {
        ok: false,
        failure: {
          reason: 'no_compatible_installer',
          message: `No installer for ${wingetId} ${latestVersion} matches architecture ${architecture || 'x64'}${requestedScope ? ` and ${requestedScope} install scope` : ''}.`,
        },
      };
    }
    installerUrl = selectedInstaller.InstallerUrl || installerUrl;
    installerSha256 = selectedInstaller.InstallerSha256 || installerSha256;
    installerType = selectedInstaller.InstallerType || installerType;
    nestedInstallerType = selectedInstaller.NestedInstallerType || undefined;
    nestedInstallerPath = Array.isArray(selectedInstaller.NestedInstallerFiles)
      ? selectedInstaller.NestedInstallerFiles[0]?.RelativeFilePath
      : undefined;
    selectedManifestInstaller = selectedInstaller as WingetInstaller;
  } else if (architecture) {
    return {
      ok: false,
      failure: {
        reason: 'installer_metadata_missing',
        message: `The catalog entry for ${wingetId} ${latestVersion} is missing per-architecture installer metadata.`,
      },
    };
  }

  if (!installerUrl) {
    return {
      ok: false,
      failure: {
        reason: 'installer_url_missing',
        message: `The installer manifest for ${wingetId} ${latestVersion} does not include a download URL.`,
      },
    };
  }

  const normalizedSha256 = normalizeInstallerSha256(installerSha256);
  if (!normalizedSha256) {
    return {
      ok: false,
      failure: {
        reason: 'installer_hash_invalid',
        message: `The installer manifest for ${wingetId} ${latestVersion} has a missing or invalid SHA-256 hash, so the download cannot be verified.`,
      },
    };
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
    ok: true,
    info: {
      wingetId,
      currentVersion: '', // Will be filled by caller
      latestVersion,
      displayName: curatedApp.name,
      installerUrl,
      installerSha256: normalizedSha256,
      installerType: installerType || 'exe',
      installCommand: buildCurrentVersionInstallCommand(normalizedInstaller),
      uninstallCommand: generateUninstallCommand(
        normalizedInstaller,
        curatedApp.name
      ),
      detectionRules: generateDetectionRules(
        normalizedInstaller,
        curatedApp.name,
        wingetId,
        latestVersion
      ),
      silentSwitches: normalizedInstaller.silentArgs,
      installerSuccessCodes: normalizedInstaller.installerSuccessCodes,
      installScope: normalizedInstaller.scope,
      nestedInstallerType,
      nestedInstallerPath,
    },
  };
}
import { customDetectionUpdateHold } from '@/lib/custom-detection';
