/**
 * Self-hosted auto-update path.
 *
 * The hosted service drives auto-updates from a Vercel cron that talks to
 * Supabase and dispatches packaging. A self-hosted SQLite deployment has no
 * Supabase and (by default) a local packager, so this module provides the same
 * outcome through the database adapter:
 *
 *   1. runSqliteUpdateCheck compares every recorded deployment with the catalog
 *      latest version, stores the results, and triggers enabled auto_update
 *      policies.
 *   2. triggerSqliteAutoUpdate applies the same safety gates as the hosted
 *      trigger and creates a queued packaging job that the local packager picks
 *      up.
 *
 * It intentionally skips the hosted-only steps: hosted QA demand (jobs go
 * straight to queued), tenant consent checks, notifications, and GitHub Actions
 * dispatch. Those remain hosted behaviour.
 */

import type { DatabaseAdapter, UploadHistoryRecord } from '@/lib/db/types';
import type { Json } from '@/types/database';
import { getCatalogSource } from '@/lib/catalog';
import { compareVersions } from '@/lib/version-compare';
import { getLatestInstallerInfo } from '@/lib/auto-update/trigger';
import {
  DEFAULT_SAFETY_CONFIG,
  canAutoUpdate,
  classifyUpdateType,
  shouldSkipUpdate,
  type AppUpdatePolicy,
  type DeploymentConfig,
} from '@/types/update-policies';

export interface SqliteUpdateInfo {
  wingetId: string;
  currentVersion: string;
  latestVersion: string;
  currentIntuneAppId: string | null;
  displayName: string;
  installerUrl: string;
  installerSha256: string;
  installerType: string;
  installCommand: string;
  uninstallCommand: string;
  installScope: string | null;
  nestedInstallerType?: string;
  nestedInstallerPath?: string;
  installerSuccessCodes?: Array<string | number>;
}

export interface SqliteTriggerResult {
  success: boolean;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
  packagingJobId?: string;
  historyId?: string;
}

export interface SqliteUpdateCheckSummary {
  available: number;
  triggered: number;
  skipped: number;
  errors: number;
}

function isMajorBump(current: string, latest: string): boolean {
  const currentMajor = Number.parseInt(current.split('.')[0] ?? '', 10);
  const latestMajor = Number.parseInt(latest.split('.')[0] ?? '', 10);
  return Number.isFinite(currentMajor) && Number.isFinite(latestMajor) && latestMajor > currentMajor;
}

async function checkRateLimits(
  db: DatabaseAdapter,
  policy: AppUpdatePolicy
): Promise<{ allowed: boolean; reason?: string }> {
  const { rateLimits } = DEFAULT_SAFETY_CONFIG;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const policies = await db.updatePolicies.listAll();

  const tenantPolicyIds = policies.filter((entry) => entry.tenant_id === policy.tenant_id).map((entry) => entry.id);
  if (tenantPolicyIds.length > 0) {
    const tenantCount = await db.autoUpdateHistory.countForPolicies(tenantPolicyIds, oneHourAgo, 'completed');
    if (tenantCount >= rateLimits.maxUpdatesPerTenant) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${rateLimits.maxUpdatesPerTenant} updates per tenant per hour`,
      };
    }
  }

  const userPolicyIds = policies.filter((entry) => entry.user_id === policy.user_id).map((entry) => entry.id);
  if (userPolicyIds.length > 0) {
    const userCount = await db.autoUpdateHistory.countForPolicies(userPolicyIds, oneHourAgo);
    if (userCount >= rateLimits.maxUpdatesPerHour) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${rateLimits.maxUpdatesPerHour} updates per hour`,
      };
    }
  }

  const cooldownSince = new Date(Date.now() - rateLimits.cooldownMinutes * 60 * 1000).toISOString();
  const recent = await db.autoUpdateHistory.countForPolicies([policy.id], cooldownSince);
  if (recent > 0) {
    return {
      allowed: false,
      reason: `Cooldown period: wait ${rateLimits.cooldownMinutes} minutes between updates`,
    };
  }

  return { allowed: true };
}

/**
 * Apply the safety gates and create a queued packaging job for an update.
 */
export async function triggerSqliteAutoUpdate(
  db: DatabaseAdapter,
  policy: AppUpdatePolicy,
  updateInfo: SqliteUpdateInfo,
  options?: { skipRateLimits?: boolean; skipPriorDeploymentCheck?: boolean }
): Promise<SqliteTriggerResult> {
  try {
    if (!canAutoUpdate(policy)) {
      return { success: false, skipped: true, skipReason: 'Policy does not allow auto-update or is disabled' };
    }

    const config = policy.deployment_config as DeploymentConfig | null;
    if (!config) {
      return { success: false, error: 'No deployment configuration saved for this policy' };
    }

    if (
      DEFAULT_SAFETY_CONFIG.requirePriorDeployment &&
      !options?.skipPriorDeploymentCheck &&
      !policy.original_upload_history_id
    ) {
      return { success: false, error: 'Auto-update requires a prior manual deployment' };
    }

    if (!options?.skipRateLimits) {
      const rateLimit = await checkRateLimits(db, policy);
      if (!rateLimit.allowed) {
        return { success: false, skipped: true, skipReason: rateLimit.reason };
      }
    }

    const updateType = classifyUpdateType(updateInfo.currentVersion, updateInfo.latestVersion);
    const now = new Date().toISOString();

    let historyId: string | undefined;
    let packagingJobId: string | undefined;

    try {
      const history = await db.autoUpdateHistory.create({
        policy_id: policy.id,
        from_version: updateInfo.currentVersion,
        to_version: updateInfo.latestVersion,
        update_type: updateType,
        status: 'pending',
        triggered_at: now,
      });
      historyId = history.id;

      const sourceIntuneAppId = updateInfo.currentIntuneAppId || null;
      const autoSupersede = Boolean(sourceIntuneAppId);

      const job = await db.jobs.create({
        user_id: policy.user_id,
        tenant_id: policy.tenant_id,
        winget_id: updateInfo.wingetId,
        version: updateInfo.latestVersion,
        display_name: config.displayName || updateInfo.displayName,
        publisher: config.publisher || 'Unknown Publisher',
        architecture: config.architecture || 'x64',
        installer_type: updateInfo.installerType || config.installerType,
        installer_url: updateInfo.installerUrl,
        installer_sha256: updateInfo.installerSha256,
        install_command: updateInfo.installCommand || config.installCommand,
        uninstall_command: updateInfo.uninstallCommand || config.uninstallCommand,
        install_scope: updateInfo.installScope || config.installScope,
        detection_rules: (config.detectionRules ?? []) as unknown as Json,
        package_config: {
          assignments: config.assignments ?? [],
          categories: config.categories ?? [],
          assignedGroups: config.assignedGroups,
          requirementRules: config.requirementRules,
          relationships: config.relationships,
          psadtConfig: config.psadtConfig,
          nestedInstallerType: updateInfo.nestedInstallerType,
          nestedInstallerPath: updateInfo.nestedInstallerPath,
          installerSuccessCodes: updateInfo.installerSuccessCodes,
          forceCreate: config.forceCreateNewApp !== false,
          sourceIntuneAppId,
          autoSupersede,
          supersedenceType: autoSupersede ? 'update' : undefined,
          description: config.description,
          notes: config.notes,
          autoUpdateHistoryId: history.id,
        } as unknown as Json,
        status: 'queued',
        status_message: 'Auto-update queued for packaging',
        progress_percent: 0,
        is_auto_update: true,
        auto_update_policy_id: policy.id,
      });
      packagingJobId = job.id;

      await db.autoUpdateHistory.update(history.id, {
        packaging_job_id: job.id,
        status: 'packaging',
      });

      await db.updatePolicies.update(policy.id, policy.user_id, {
        last_auto_update_at: now,
        last_auto_update_version: updateInfo.latestVersion,
        consecutive_failures: 0,
        updated_at: now,
      });

      return { success: true, packagingJobId: job.id, historyId: history.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // A failure after the job insert must not leave a stray queued job (which
      // the next run could duplicate) or a dangling pending history row.
      if (packagingJobId) {
        await db.jobs.deleteById(packagingJobId).catch(() => false);
      }
      if (historyId) {
        await db.autoUpdateHistory
          .update(historyId, {
            status: 'failed',
            error_message: message,
            completed_at: new Date().toISOString(),
          })
          .catch(() => null);
      }
      return { success: false, error: message };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Compare every recorded deployment with the catalog latest version, store the
 * results, and trigger enabled auto_update policies.
 */
export async function runSqliteUpdateCheck(
  db: DatabaseAdapter,
  options?: { userId?: string; now?: Date }
): Promise<SqliteUpdateCheckSummary> {
  const catalog = getCatalogSource();
  const deployments = await db.uploadHistory.listAll(2000);
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();

  // Newest deployment per (user, tenant, app, intune app). listAll is newest first.
  const newest = new Map<string, UploadHistoryRecord>();
  for (const deployment of deployments) {
    if (options?.userId && deployment.user_id !== options.userId) continue;
    const key = `${deployment.user_id}|${deployment.intune_tenant_id ?? ''}|${deployment.winget_id}|${deployment.intune_app_id}`;
    if (!newest.has(key)) newest.set(key, deployment);
  }

  const wingetIds = [...new Set([...newest.values()].map((deployment) => deployment.winget_id))];
  const apps = wingetIds.length > 0 ? await catalog.getAppsByWingetIds(wingetIds).catch(() => []) : [];
  const latestVersionByWinget = new Map(apps.map((app) => [app.winget_id, app.latest_version]));

  const keepByScope = new Map<string, Array<{ wingetId: string; intuneAppId: string }>>();
  const allScopes = new Set<string>();
  let available = 0;

  // Fetch policies once: they both drive triggering and mark scopes that must
  // be cleaned even when their app is no longer deployed.
  const policies = await db.updatePolicies.listAll();
  for (const policy of policies) {
    // A user-scoped check (the on-demand refresh) must never clean another
    // user's scopes, so only their own policies seed the cleanup set.
    if (options?.userId && policy.user_id !== options.userId) continue;
    allScopes.add(`${policy.user_id}|${policy.tenant_id}`);
  }

  for (const deployment of newest.values()) {
    const tenantId = deployment.intune_tenant_id ?? '';
    const scopeKey = `${deployment.user_id}|${tenantId}`;
    allScopes.add(scopeKey);

    const latestVersion = latestVersionByWinget.get(deployment.winget_id);
    if (!latestVersion) continue;
    if (compareVersions(deployment.version, latestVersion) >= 0) continue;

    await db.updateCheckResults.upsert({
      user_id: deployment.user_id,
      tenant_id: tenantId,
      winget_id: deployment.winget_id,
      intune_app_id: deployment.intune_app_id,
      display_name: deployment.display_name,
      current_version: deployment.version,
      latest_version: latestVersion,
      is_critical: isMajorBump(deployment.version, latestVersion),
      is_managed: true,
      detected_at: nowIso,
      updated_at: nowIso,
    });
    available += 1;

    const keep = keepByScope.get(scopeKey) ?? [];
    keep.push({ wingetId: deployment.winget_id, intuneAppId: deployment.intune_app_id });
    keepByScope.set(scopeKey, keep);
  }

  // Clean every known scope. A scope whose apps are all up to date gets an empty
  // keep list, so its previously detected updates are removed.
  for (const scopeKey of allScopes) {
    const [userId, tenantId] = scopeKey.split('|');
    await db.updateCheckResults.deleteMissing(userId, tenantId, keepByScope.get(scopeKey) ?? []);
  }

  let triggered = 0;
  let skipped = 0;
  let errors = 0;

  for (const policy of policies) {
    if (options?.userId && policy.user_id !== options.userId) continue;
    if (!canAutoUpdate(policy)) continue;

    const latestVersion = latestVersionByWinget.get(policy.winget_id);
    if (!latestVersion) continue;
    if (policy.last_auto_update_version === latestVersion) continue;
    if (shouldSkipUpdate(policy, latestVersion)) continue;

    const deployment = await db.uploadHistory.getLatest(policy.user_id, policy.tenant_id, policy.winget_id);
    if (!deployment) continue;
    // Only act when the deployed version is actually behind the catalog.
    if (compareVersions(deployment.version, latestVersion) >= 0) continue;

    const config = policy.deployment_config as DeploymentConfig | null;
    const resolution = await getLatestInstallerInfo(
      null as never,
      policy.winget_id,
      config?.architecture,
      config?.installScope
    );
    if (!resolution.ok) {
      skipped += 1;
      continue;
    }

    const result = await triggerSqliteAutoUpdate(db, policy, {
      wingetId: policy.winget_id,
      currentVersion: deployment.version,
      latestVersion: resolution.info.latestVersion,
      currentIntuneAppId: deployment.intune_app_id,
      displayName: resolution.info.displayName,
      installerUrl: resolution.info.installerUrl,
      installerSha256: resolution.info.installerSha256,
      installerType: resolution.info.installerType,
      installCommand: resolution.info.installCommand ?? '',
      uninstallCommand: resolution.info.uninstallCommand ?? '',
      installScope: resolution.info.installScope ?? null,
      nestedInstallerType: resolution.info.nestedInstallerType,
      nestedInstallerPath: resolution.info.nestedInstallerPath,
      installerSuccessCodes: resolution.info.installerSuccessCodes,
    });

    if (result.success) triggered += 1;
    else if (result.skipped) skipped += 1;
    else errors += 1;
  }

  return { available, triggered, skipped, errors };
}
