/**
 * Shared deployment-config builder for update policies.
 *
 * These helpers and the orchestrator below are used by both the manual
 * trigger route (`app/api/updates/trigger`) and the policy POST route
 * (`app/api/update-policies`) so that pin_version / auto_update can derive a
 * deployment configuration server-side from a prior deployment or the catalog.
 */

import { createServerClient } from '@/lib/supabase';
import { getCatalogSource } from '@/lib/catalog';
import {
  generateDetectionRules,
  generateInstallCommand,
  generateUninstallCommand,
} from '@/lib/detection-rules';
import type { DeploymentConfig } from '@/types/update-policies';
import type { IntuneAppCategorySelection, PackageAssignment } from '@/types/upload';
import type { AppRelationship, DetectionRule, RequirementRule } from '@/types/intune';
import type { NormalizedInstaller } from '@/types/winget';

export interface PackageConfigWithAssignments {
  assignments?: PackageAssignment[];
  categories?: IntuneAppCategorySelection[];
  categoryIds?: string[];
  assignedGroups?: Array<{
    groupId?: string;
    groupName?: string;
    assignmentType?: 'required' | 'available' | 'uninstall' | 'updateOnly';
  }>;
  requirementRules?: RequirementRule[];
  relationships?: AppRelationship[];
  assignmentMigration?: {
    carryOverAssignments?: boolean;
    removeAssignmentsFromPreviousApp?: boolean;
  };
  carryOverAssignments?: boolean;
  removeAssignmentsFromPreviousApp?: boolean;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parsePackageAssignments(packageConfig: unknown): PackageAssignment[] {
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
        intent !== 'uninstall' &&
        intent !== 'updateOnly'
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
    .filter((group): group is { groupId: string; groupName?: string; assignmentType?: 'required' | 'available' | 'uninstall' | 'updateOnly' } => {
      return isObject(group) && typeof group.groupId === 'string' && group.groupId.length > 0;
    })
    .map((group) => ({
      type: 'group',
      groupId: group.groupId,
      groupName: typeof group.groupName === 'string' ? group.groupName : undefined,
      intent: group.assignmentType || 'required',
    }));
}

export function parseRequirementRules(packageConfig: unknown): RequirementRule[] | undefined {
  if (!isObject(packageConfig)) {
    return undefined;
  }
  const typedConfig = packageConfig as PackageConfigWithAssignments;
  if (Array.isArray(typedConfig.requirementRules) && typedConfig.requirementRules.length > 0) {
    return typedConfig.requirementRules as RequirementRule[];
  }
  return undefined;
}

export function parseAppRelationships(packageConfig: unknown): AppRelationship[] {
  if (!isObject(packageConfig)) {
    return [];
  }

  const relationships = packageConfig.relationships;
  if (!Array.isArray(relationships)) {
    return [];
  }

  return relationships.filter((relationship): relationship is AppRelationship => {
    if (!isObject(relationship)) {
      return false;
    }

    const relationshipType = relationship.relationshipType;
    if (relationshipType !== 'dependency' && relationshipType !== 'supersedence') {
      return false;
    }

    if (typeof relationship.targetId !== 'string' || relationship.targetId.length === 0) {
      return false;
    }

    if (
      relationship.dependencyType !== undefined &&
      relationship.dependencyType !== 'detect' &&
      relationship.dependencyType !== 'autoInstall'
    ) {
      return false;
    }

    if (
      relationship.supersedenceType !== undefined &&
      relationship.supersedenceType !== 'update' &&
      relationship.supersedenceType !== 'replace'
    ) {
      return false;
    }

    return true;
  });
}

export function parseAssignmentMigration(packageConfig: unknown): DeploymentConfig['assignmentMigration'] | undefined {
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

export function parsePackageCategories(packageConfig: unknown): IntuneAppCategorySelection[] {
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

export function parseDetectionRules(value: unknown): DetectionRule[] {
  return Array.isArray(value) ? (value as DetectionRule[]) : [];
}

export function parsePsadtConfig(packageConfig: unknown): DeploymentConfig['psadtConfig'] {
  if (!isObject(packageConfig)) {
    return undefined;
  }
  const psadtConfig = packageConfig.psadtConfig;
  if (!isObject(psadtConfig)) {
    return undefined;
  }
  return psadtConfig as unknown as DeploymentConfig['psadtConfig'];
}

/**
 * Build a deployment config from curated catalog data for apps
 * that were never deployed through IntuneGet.
 */
export async function buildDefaultDeploymentConfig(
  // Kept for call-site compatibility; the catalog source owns client creation.
  _supabase: ReturnType<typeof createServerClient>,
  wingetId: string,
  latestVersion: string
): Promise<DeploymentConfig | null> {
  // Get curated app info
  const curatedApp = await getCatalogSource().getAppNamePublisher(wingetId);

  if (!curatedApp) {
    return null;
  }

  // Get version history for installer metadata
  const versionInfo = await getCatalogSource().getVersionInstallerInfo(
    wingetId,
    latestVersion
  );

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

/**
 * Result of buildDeploymentConfigForApp.
 *  - ok: a config was built (from a prior deployment or the catalog default).
 *  - orphaned_job: a prior deployment exists but its packaging job is gone, so
 *    the saved config cannot be retrieved (distinct from "no deployment").
 *  - unavailable: no prior packaging job AND the catalog cannot produce a
 *    default config.
 */
export type BuildDeploymentConfigResult =
  | { status: 'ok'; deploymentConfig: DeploymentConfig; originalUploadHistoryId: string | null }
  | { status: 'orphaned_job' }
  | { status: 'unavailable' };

/**
 * Orchestrator: build a deployment config for an app, replicating the
 * trigger route's "no policy yet" branch.
 */
export async function buildDeploymentConfigForApp(
  supabase: ReturnType<typeof createServerClient>,
  args: {
    userId: string;
    tenantId: string;
    wingetId: string;
    latestVersion: string;
    globalCarryOver: boolean;
  }
): Promise<BuildDeploymentConfigResult> {
  const { userId, tenantId, wingetId, latestVersion, globalCarryOver } = args;

  // Get the original deployment config from upload_history
  const { data: uploadHistory } = await supabase
    .from('upload_history')
    .select('id, packaging_job_id')
    .eq('user_id', userId)
    .eq('intune_tenant_id', tenantId)
    .eq('winget_id', wingetId)
    .order('deployed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (uploadHistory?.packaging_job_id) {
    // Has prior deployment: extract config from packaging job
    const { data: packagingJob } = await supabase
      .from('packaging_jobs')
      .select('*')
      .eq('id', uploadHistory.packaging_job_id)
      .maybeSingle();

    if (!packagingJob) {
      // Prior deployment exists but its packaging job is gone.
      return { status: 'orphaned_job' };
    }

    const packageConfig = packagingJob.package_config;
    const parsedAssignments = parsePackageAssignments(packageConfig);
    const parsedCategories = parsePackageCategories(packageConfig);
    const parsedRequirementRules = parseRequirementRules(packageConfig);
    const parsedRelationships = parseAppRelationships(packageConfig);
    let assignmentMigration = parseAssignmentMigration(packageConfig);

    // If no explicit migration config was stored on the packaging job,
    // fall back to the user's global carryOverAssignments setting.
    if (!assignmentMigration) {
      assignmentMigration = {
        carryOverAssignments: globalCarryOver,
        removeAssignmentsFromPreviousApp: globalCarryOver,
      };
    }

    const deploymentConfig: DeploymentConfig = {
      displayName: packagingJob.display_name,
      publisher: packagingJob.publisher || 'Unknown Publisher',
      architecture: packagingJob.architecture || 'x64',
      installerType: packagingJob.installer_type || 'exe',
      installCommand: packagingJob.install_command || '',
      uninstallCommand: packagingJob.uninstall_command || '',
      installScope: packagingJob.install_scope || 'system',
      detectionRules: parseDetectionRules(packagingJob.detection_rules),
      assignments: parsedAssignments,
      categories: parsedCategories,
      requirementRules: parsedRequirementRules,
      relationships: parsedRelationships.length > 0 ? parsedRelationships : undefined,
      psadtConfig: parsePsadtConfig(packageConfig),
      forceCreateNewApp: true,
      assignmentMigration,
    };

    return { status: 'ok', deploymentConfig, originalUploadHistoryId: uploadHistory.id };
  }

  // No prior deployment: build config from curated catalog data
  const defaultConfig = await buildDefaultDeploymentConfig(
    supabase,
    wingetId,
    latestVersion
  );

  if (!defaultConfig) {
    return { status: 'unavailable' };
  }

  return { status: 'ok', deploymentConfig: defaultConfig, originalUploadHistoryId: null };
}
