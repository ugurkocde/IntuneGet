/**
 * Update Policies Types
 * TypeScript interfaces for automated update management
 */

import type { Json } from './database';
import type { AppRelationship, DetectionRule, RequirementRule } from './intune';
import type { PSADTConfig } from './psadt';
import type { IntuneAppCategorySelection, PackageAssignment } from './upload';

// Policy type options
export type UpdatePolicyType = 'auto_update' | 'notify' | 'ignore' | 'pin_version';

// Auto-update history status
export type AutoUpdateStatus = 'pending' | 'packaging' | 'deploying' | 'completed' | 'failed' | 'cancelled';

// Update type classification
export type UpdateType = 'patch' | 'minor' | 'major';
export type AutoUpdateScope = 'all' | 'minor' | 'major';

/**
 * Deployment configuration saved for auto-updates
 * Contains all information needed to re-deploy an app with a new version
 */
export interface DeploymentConfig {
  sourceType?: 'winget' | 'custom' | 'curated';
  curatedReleaseId?: string;
  curatedSettingsMode?: 'tested-defaults' | 'custom';
  // App information
  displayName: string;
  publisher: string;
  architecture: string;
  installerType: string;

  // Install configuration
  installCommand: string;
  uninstallCommand: string;
  installScope: string;

  // Detection rules
  detectionRules: DetectionRule[];

  // Group assignments (optional)
  assignedGroups?: {
    groupId: string;
    groupName: string;
    assignmentType: 'required' | 'available' | 'uninstall' | 'updateOnly';
  }[];

  // Normalized assignment shape used by packaging workflows
  assignments?: PackageAssignment[];

  // Intune app categories (optional)
  categories?: IntuneAppCategorySelection[];

  // Requirement rules for "Update Only" mode (optional)
  requirementRules?: RequirementRule[];

  // App relationships (dependencies / supersedence) carried over from the
  // original deployment (optional)
  relationships?: AppRelationship[];

  // Update deployment behavior (optional)
  forceCreateNewApp?: boolean;
  assignmentMigration?: {
    carryOverAssignments: boolean;
    removeAssignmentsFromPreviousApp: boolean;
  };

  // PSADT settings from the original deployment (deploy mode, command
  // overrides, verifyInstall, removeExistingInstall, registryMarkerPath, ...)
  // so updates behave like the deployment that created the app
  psadtConfig?: PSADTConfig;

  // Additional metadata
  description?: string;
  notes?: string;
}

/**
 * App Update Policy
 * Per-app configuration for how updates should be handled
 */
export interface AppUpdatePolicy {
  id: string;
  user_id: string;
  tenant_id: string;
  winget_id: string;
  policy_type: UpdatePolicyType;
  auto_update_scope?: AutoUpdateScope;
  pinned_version: string | null;
  deployment_config: DeploymentConfig | null;
  original_upload_history_id: string | null;
  last_auto_update_at: string | null;
  last_auto_update_version: string | null;
  is_enabled: boolean;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating/updating a policy
 */
export interface AppUpdatePolicyInput {
  winget_id: string;
  tenant_id: string;
  policy_type: UpdatePolicyType;
  auto_update_scope?: AutoUpdateScope;
  pinned_version?: string;
  deployment_config?: DeploymentConfig;
  original_upload_history_id?: string;
  is_enabled?: boolean;
}

/**
 * Auto Update History Record
 * Tracks each auto-update attempt
 */
export interface AutoUpdateHistory {
  id: string;
  policy_id: string;
  packaging_job_id: string | null;
  from_version: string;
  to_version: string;
  update_type: UpdateType;
  status: AutoUpdateStatus;
  error_message: string | null;
  triggered_at: string;
  completed_at: string | null;
}

/**
 * Extended auto-update history with policy details
 */
export interface AutoUpdateHistoryWithPolicy extends AutoUpdateHistory {
  policy: {
    winget_id: string;
    tenant_id: string;
  };
  display_name?: string;
}

/**
 * Update policy stats view row
 */
export interface UpdatePolicyStats {
  user_id: string;
  tenant_id: string;
  total_policies: number;
  auto_update_enabled: number;
  notify_only: number;
  ignored: number;
  pinned: number;
  successful_updates_30d: number;
  failed_updates_30d: number;
}

/**
 * Available update with policy information
 * Combines update_check_results with policy data
 */
export interface AvailableUpdate {
  id: string;
  user_id: string;
  tenant_id: string;
  winget_id: string;
  intune_app_id: string;
  display_name: string;
  current_version: string;
  latest_version: string;
  is_critical: boolean;
  large_icon_type?: string | null;
  large_icon_value?: string | null;
  detected_at: string;
  notified_at: string | null;
  dismissed_at: string | null;
  // Whether this app was previously deployed through IntuneGet
  has_prior_deployment: boolean;
  // Whether this update was matched to an IntuneGet-managed app (deployed,
  // claimed, or explicitly mapped) vs. a fuzzy/heuristic name match.
  is_managed: boolean;
  // Policy data (if exists)
  policy?: {
    id: string;
    policy_type: UpdatePolicyType;
    auto_update_scope?: AutoUpdateScope;
    is_enabled: boolean;
    pinned_version: string | null;
    last_auto_update_at: string | null;
    last_auto_update_version: string | null;
    consecutive_failures: number;
  } | null;
}

/**
 * Trigger update request
 */
export interface TriggerUpdateRequest {
  // Single update
  winget_id?: string;
  tenant_id?: string;

  // Bulk update
  updates?: {
    winget_id: string;
    tenant_id: string;
  }[];
}

/**
 * Trigger update response
 */
export interface TriggerUpdateResponse {
  success: boolean;
  triggered: number;
  failed: number;
  results: {
    winget_id: string;
    tenant_id: string;
    success: boolean;
    skipped?: boolean;
    code?:
      | 'QA_FAILED_CURRENT_VERSION'
      | 'QA_NOT_PASSED_CURRENT_VERSION'
      | 'QA_SECURITY_FLAGGED_CURRENT_VERSION'
      | 'QA_PACKAGE_COMPATIBILITY_BLOCKED'
      | 'CURATED_LICENCE_NOT_ACCEPTED'
      | 'CURATED_CONFIG_VERIFICATION_REQUIRED'
      | 'INTUNE_APPROVAL_PENDING'
      | 'CURATED_CONFIG_VERIFICATION_FAILED'
        | 'UPDATE_SCOPE_HELD'
      | 'RATE_LIMIT_UNVERIFIED'
      | 'PSADT_BACKFILL_UNAVAILABLE';
    packaging_job_id?: string;
    error?: string;
  }[];
}

/**
 * Dashboard stats for Updates page
 */
export interface UpdateDashboardStats {
  availableUpdates: number;
  criticalUpdates: number;
  autoUpdateEnabled: number;
  recentAutoUpdates: number;
  failedUpdates: number;
}

/**
 * Rate limit configuration for auto-updates
 */
export interface AutoUpdateRateLimits {
  maxUpdatesPerHour: number;
  maxUpdatesPerTenant: number;
  cooldownMinutes: number;
}

/**
 * Safety feature configuration
 */
export interface AutoUpdateSafetyConfig {
  // Circuit breaker: max consecutive failures before disabling
  maxConsecutiveFailures: number;

  // Require at least one successful manual deployment first
  requirePriorDeployment: boolean;

  // Re-verify consent before each deployment
  verifyConsentBeforeDeployment: boolean;

  // Rate limiting
  rateLimits: AutoUpdateRateLimits;
}

// Default safety configuration
export const DEFAULT_SAFETY_CONFIG: AutoUpdateSafetyConfig = {
  maxConsecutiveFailures: 3,
  requirePriorDeployment: true,
  verifyConsentBeforeDeployment: true,
  rateLimits: {
    maxUpdatesPerHour: 5,
    maxUpdatesPerTenant: 10,
    cooldownMinutes: 5,
  },
};

/**
 * Helper function to determine update type from version strings
 */
function parseComparableVersion(value: string): number[] | null {
  const normalized = value.trim().replace(/^[vV]/, '');
  // Reject suffixes and nonnumeric schemes rather than guessing for a write gate.
  if (!/^\d+(?:\.\d+){0,3}$/.test(normalized)) return null;
  const parts = normalized.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? [...parts, ...Array(4 - parts.length).fill(0)] : null;
}

export function classifyUpdateType(fromVersion: string, toVersion: string): UpdateType {
  // Preserve prefix based display/history labels for vendor prerelease suffixes.
  // Restricted write decisions independently require the strict parser below.
  const parseLabel = (value: string) => {
    const match = value.trim().replace(/^[vV]/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : [0, 0, 0];
  };
  const from = parseLabel(fromVersion);
  const to = parseLabel(toVersion);
  if (to[0] > from[0]) return 'major';
  if (to[0] === from[0] && to[1] > from[1]) return 'minor';
  return 'patch';
}

export function isAutoUpdateScope(value: unknown): value is AutoUpdateScope {
  return value === 'all' || value === 'minor' || value === 'major';
}

/** A hold reason is shown without hiding the update or changing notifications. */
export function autoUpdateScopeReason(scope: unknown, fromVersion: string, toVersion: string): string | null {
  if (scope === undefined || scope === null || scope === 'all') return null;
  if (!isAutoUpdateScope(scope)) return 'Invalid automatic update scope. Choose a supported scope.';
  const from = parseComparableVersion(fromVersion);
  const to = parseComparableVersion(toVersion);
  if (!from || !to) return 'Held by scope: version formats cannot be compared safely. Deploy manually or choose All updates.';
  const firstDifference = to.findIndex((part, index) => part !== from[index]);
  if (firstDifference < 0 || to[firstDifference] < from[firstDifference]) return 'Held by scope: the target version is not newer.';
  const kind = classifyUpdateType(fromVersion, toVersion);
  if (kind === 'major' || (scope === 'minor' && kind === 'minor')) return null;
  return scope === 'major' ? 'Held by scope: Major only excludes this update.' : 'Held by scope: Minor and major excludes patch updates.';
}

/**
 * Helper to check if a policy allows auto-update
 */
export function canAutoUpdate(policy: AppUpdatePolicy | null | undefined): boolean {
  if (!policy) return false;
  return policy.policy_type === 'auto_update' && policy.is_enabled && policy.consecutive_failures < 3;
}

/**
 * Helper to check if update should be skipped based on policy
 */
export function shouldSkipUpdate(
  policy: Pick<AppUpdatePolicy, 'policy_type' | 'pinned_version'> | null | undefined,
  latestVersion: string
): boolean {
  if (!policy) return false;

  // Ignore policy - skip all updates
  if (policy.policy_type === 'ignore') return true;

  // Pin version policy - skip if not the pinned version
  if (policy.policy_type === 'pin_version' && policy.pinned_version) {
    return latestVersion !== policy.pinned_version;
  }

  return false;
}
