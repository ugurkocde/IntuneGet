/**
 * Update Policies Types
 * TypeScript interfaces for automated update management
 */

import type { Json } from './database';
import type { DetectionRule } from './intune';
import type { PackageAssignment } from './upload';

// Policy type options
export type UpdatePolicyType = 'auto_update' | 'notify' | 'ignore' | 'pin_version';

// Auto-update history status
export type AutoUpdateStatus = 'pending' | 'packaging' | 'deploying' | 'completed' | 'failed' | 'cancelled';

// Update type classification
export type UpdateType = 'patch' | 'minor' | 'major';

/**
 * Deployment configuration saved for auto-updates
 * Contains all information needed to re-deploy an app with a new version
 */
export interface DeploymentConfig {
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
    assignmentType: 'required' | 'available' | 'uninstall';
  }[];

  // Normalized assignment shape used by packaging workflows
  assignments?: PackageAssignment[];

  // Update deployment behavior (optional)
  forceCreateNewApp?: boolean;
  assignmentMigration?: {
    carryOverAssignments: boolean;
    removeAssignmentsFromPreviousApp: boolean;
  };

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
  // Policy data (if exists)
  policy?: {
    id: string;
    policy_type: UpdatePolicyType;
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
export function classifyUpdateType(fromVersion: string, toVersion: string): UpdateType {
  const parseSimple = (v: string) => {
    const match = v.match(/^(\d+)\.(\d+)\.?(\d+)?/);
    if (!match) return { major: 0, minor: 0, patch: 0 };
    return {
      major: parseInt(match[1], 10) || 0,
      minor: parseInt(match[2], 10) || 0,
      patch: parseInt(match[3], 10) || 0,
    };
  };

  const from = parseSimple(fromVersion);
  const to = parseSimple(toVersion);

  if (to.major > from.major) return 'major';
  if (to.minor > from.minor) return 'minor';
  return 'patch';
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
  policy: AppUpdatePolicy | null | undefined,
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
