/**
 * HASH_MISMATCH auto-requeue
 *
 * Some winget packages publish installers on rolling URLs whose content is
 * replaced in place (e.g. Google Chrome's enterprise MSI). When the upstream
 * binary changes between catalog sync and packaging, the workflow fails with
 * HASH_MISMATCH even though a manifest with the current hash already exists
 * in winget-pkgs. This module refreshes the installer data live from
 * winget-pkgs and re-dispatches the same job once, so the common stale-hash
 * case self-heals without user action.
 */

import type { DatabaseAdapter } from '@/lib/db/types';
import type { PackagingJob } from '@/lib/db/types';
import type { Json } from '@/types/database';
import type { NormalizedInstaller } from '@/types/winget';
import { fetchAvailableVersionsLive, getLiveInstallers } from '@/lib/manifest-api';
import {
  isGitHubActionsConfigured,
  triggerPackagingWorkflow,
  type WorkflowInputs,
} from '@/lib/github-actions';
import { getFeatureFlags } from '@/lib/features';
import { getAppConfig } from '@/lib/config';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import { buildIntuneAppDescription } from '@/lib/intune-description';
import { isValidSha256 } from '@/lib/custom-app';

const GUID_PATTERN = /\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/;

interface PackageConfig {
  [key: string]: unknown;
  sourceType?: string;
  hashMismatchRetried?: boolean;
  description?: string;
  psadtConfig?: unknown;
  requirementRules?: unknown;
  assignments?: unknown;
  categories?: unknown;
  espProfiles?: unknown;
  relationships?: unknown[];
  nestedInstallerType?: string;
  nestedInstallerPath?: string;
  sourceIntuneAppId?: string;
  carryOverAssignments?: boolean;
  removeAssignmentsFromPreviousApp?: boolean;
  autoSupersede?: boolean;
  supersedenceType?: string;
  // Auto-update jobs nest the carry-over flags under assignmentMigration
  assignmentMigration?: {
    carryOverAssignments?: boolean;
    removeAssignmentsFromPreviousApp?: boolean;
  };
}

/**
 * Pick the installer matching the failed job's architecture, preferring the
 * same installer type and scope. Mirrors getBestInstaller's arch fallback.
 */
function pickInstaller(
  installers: NormalizedInstaller[],
  architecture: string | null,
  installerType: string | null,
  installScope: string | null
): NormalizedInstaller | null {
  if (installers.length === 0) return null;

  const archPriority: Record<string, string[]> = {
    x64: ['x64', 'neutral', 'x86'],
    x86: ['x86', 'neutral', 'x64'],
    arm64: ['arm64', 'arm', 'neutral', 'x64'],
  };
  const priority = archPriority[architecture || 'x64'] || archPriority.x64;

  for (const arch of priority) {
    const candidates = installers.filter((i) => i.architecture === arch);
    if (candidates.length === 0) continue;
    return (
      candidates.find(
        (i) => i.type === installerType && (!installScope || !i.scope || i.scope === installScope)
      ) ||
      candidates.find((i) => i.type === installerType) ||
      candidates[0]
    );
  }

  return installers[0];
}

/**
 * MSI/WiX uninstall commands pin the per-version product code. When the
 * refreshed installer declares a new product code, swap it into the stored
 * command so uninstall keeps working for the version actually deployed.
 */
function refreshUninstallCommand(
  uninstallCommand: string | null,
  productCode: string | undefined
): string {
  const command = uninstallCommand || '';
  if (!command || !productCode || !GUID_PATTERN.test(productCode)) {
    return command;
  }
  return command.replace(GUID_PATTERN, productCode);
}

function buildCallbackUrl(): string {
  const config = getAppConfig();
  const baseUrl =
    config.app.url ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return `${baseUrl}/api/package/callback`;
}

/**
 * Attempt to requeue a job that failed with HASH_MISMATCH using freshly
 * fetched installer data from winget-pkgs. Returns true when the job was
 * reset and re-dispatched; false when requeueing is not applicable (the job
 * stays failed). Never throws.
 */
export async function tryHashMismatchRequeue(
  db: DatabaseAdapter,
  job: PackagingJob
): Promise<boolean> {
  try {
    // Only the GitHub Actions pipeline is re-dispatched from here. In local
    // packager mode jobs follow a different lifecycle, so leave them failed.
    const flags = getFeatureFlags();
    if (flags.localPackager || !isGitHubActionsConfigured()) {
      return false;
    }

    const config: PackageConfig =
      job.package_config && typeof job.package_config === 'object' && !Array.isArray(job.package_config)
        ? (job.package_config as PackageConfig)
        : {};

    // Custom apps are not in winget-pkgs; there is no manifest to refresh.
    if (config.sourceType === 'custom' || job.winget_id.startsWith('Custom.')) {
      return false;
    }

    // One automatic retry only.
    if (config.hashMismatchRetried === true) {
      console.log(`[HashMismatchRetry] Job ${job.id} already retried once, leaving failed`);
      return false;
    }

    // Resolve the latest version and its installers live from winget-pkgs,
    // bypassing the Supabase cache that produced the stale hash.
    const versions = await fetchAvailableVersionsLive(job.winget_id);
    if (versions.length === 0) {
      return false;
    }
    const latestVersion = versions[0];

    const installers = await getLiveInstallers(job.winget_id, latestVersion);
    const fresh = pickInstaller(installers, job.architecture, job.installer_type, job.install_scope);
    if (!fresh || !fresh.url || !isValidSha256(fresh.sha256 || '')) {
      return false;
    }

    // If upstream data is unchanged, a retry would fail the same way.
    if (
      fresh.sha256.toUpperCase() === (job.installer_sha256 || '').toUpperCase() &&
      latestVersion === job.version
    ) {
      console.log(`[HashMismatchRetry] Job ${job.id}: winget-pkgs still has the same hash, leaving failed`);
      return false;
    }

    const refreshedUninstall = refreshUninstallCommand(job.uninstall_command, fresh.productCode);
    const carryOverAssignments =
      config.assignmentMigration?.carryOverAssignments ?? config.carryOverAssignments;
    const removeAssignmentsFromPreviousApp =
      config.assignmentMigration?.removeAssignmentsFromPreviousApp ??
      config.removeAssignmentsFromPreviousApp;

    const updatedConfig: PackageConfig = {
      ...config,
      version: latestVersion,
      installerUrl: fresh.url,
      installerSha256: fresh.sha256,
      hashMismatchRetried: true,
    };

    // Reset the job before dispatching so a fast first callback from the new
    // run cannot race a still-failed row. Optimistic condition: only requeue
    // a job that is still in the failed state this callback produced.
    const requeuedJob = await db.jobs.update(
      job.id,
      {
        status: 'packaging',
        status_message: `Installer changed upstream - retrying automatically with refreshed manifest (v${latestVersion})`,
        progress_percent: 0,
        error_message: null,
        error_stage: null,
        error_category: null,
        error_code: null,
        error_details: null,
        completed_at: null,
        version: latestVersion,
        installer_url: fresh.url,
        installer_sha256: fresh.sha256,
        uninstall_command: refreshedUninstall || job.uninstall_command,
        package_config: updatedConfig as Json,
        packaging_started_at: new Date().toISOString(),
      },
      { status: 'failed' }
    );

    if (!requeuedJob) {
      return false;
    }

    const effectiveType = fresh.type || job.installer_type || 'exe';
    const workflowInputs: WorkflowInputs = {
      jobId: job.id,
      tenantId: job.tenant_id || '',
      wingetId: job.winget_id,
      displayName: job.display_name,
      description: buildIntuneAppDescription({
        description: config.description,
        fallback: `Deployed via IntuneGet from Winget: ${job.winget_id}`,
      }),
      publisher: job.publisher || 'Unknown Publisher',
      version: latestVersion,
      architecture: job.architecture || 'x64',
      installerUrl: fresh.url,
      installerSha256: fresh.sha256,
      installerType: effectiveType,
      nestedInstallerType: fresh.nestedInstallerType ?? config.nestedInstallerType,
      nestedInstallerPath: fresh.nestedInstallerPath ?? config.nestedInstallerPath,
      silentSwitches: extractSilentSwitches(job.install_command || '', effectiveType),
      uninstallCommand: refreshedUninstall,
      callbackUrl: buildCallbackUrl(),
      psadtConfig: config.psadtConfig ? JSON.stringify(config.psadtConfig) : undefined,
      detectionRules: job.detection_rules ? JSON.stringify(job.detection_rules) : undefined,
      requirementRules: config.requirementRules ? JSON.stringify(config.requirementRules) : undefined,
      assignments: config.assignments ? JSON.stringify(config.assignments) : undefined,
      categories: config.categories ? JSON.stringify(config.categories) : undefined,
      espProfiles: config.espProfiles ? JSON.stringify(config.espProfiles) : undefined,
      relationships:
        Array.isArray(config.relationships) && config.relationships.length > 0
          ? JSON.stringify(config.relationships)
          : undefined,
      installScope: job.install_scope === 'user' ? 'user' : 'machine',
      // The user already chose to deploy; the failed attempt may itself have
      // passed a duplicate warning, so do not let the retry get skipped.
      forceCreate: true,
      sourceIntuneAppId: config.sourceIntuneAppId,
      carryOverAssignments,
      removeAssignmentsFromPreviousApp,
      autoSupersede: config.autoSupersede,
      supersedenceType: config.supersedenceType,
    };

    try {
      await triggerPackagingWorkflow(workflowInputs);
    } catch (dispatchError) {
      // Put the job back into the failed state it was in before the requeue,
      // keeping the retry marker so the failure cannot loop.
      await db.jobs.update(
        job.id,
        {
          status: 'failed',
          status_message: job.status_message,
          error_message: job.error_message || 'SHA256 hash mismatch',
          error_stage: job.error_stage,
          error_category: job.error_category,
          error_code: job.error_code,
          error_details: job.error_details,
          version: job.version,
          installer_url: job.installer_url,
          installer_sha256: job.installer_sha256,
          uninstall_command: job.uninstall_command,
          package_config: { ...config, hashMismatchRetried: true } as Json,
          completed_at: new Date().toISOString(),
        },
        { status: 'packaging' }
      );
      console.error(`[HashMismatchRetry] Dispatch failed for job ${job.id}:`, dispatchError);
      return false;
    }

    console.log(
      `[HashMismatchRetry] Job ${job.id} requeued with refreshed manifest v${latestVersion} for ${job.winget_id}`
    );
    return true;
  } catch (error) {
    console.error(`[HashMismatchRetry] Requeue attempt for job ${job.id} failed:`, error);
    return false;
  }
}
