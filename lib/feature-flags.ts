/**
 * Feature Flags and Tier Management
 * Control feature access based on subscription tier
 */

// ============================================
// Types
// ============================================

export type SubscriptionTier = 'free' | 'pro' | 'msp';

export interface TierLimits {
  maxTenants: number | null; // null = unlimited
  maxTeamMembers: number | null;
  maxDeploymentsPerMonth: number | null;
  auditRetentionDays: number;
  features: {
    batchDeployment: boolean;
    exportReports: boolean;
    customBranding: boolean;
    apiAccess: boolean;
    prioritySupport: boolean;
  };
}

export type Feature =
  | 'batch_deployment'
  | 'export_reports'
  | 'custom_branding'
  | 'api_access'
  | 'priority_support'
  | 'unlimited_tenants'
  | 'unlimited_members'
  | 'extended_audit';

// ============================================
// Tier Definitions
// ============================================

const tierLimits: Record<SubscriptionTier, TierLimits> = {
  free: {
    maxTenants: null, // unlimited
    maxTeamMembers: null, // unlimited
    maxDeploymentsPerMonth: null, // unlimited
    auditRetentionDays: 365,
    features: {
      batchDeployment: true,
      exportReports: true,
      customBranding: true,
      apiAccess: true,
      prioritySupport: true,
    },
  },
  pro: {
    maxTenants: null, // unlimited
    maxTeamMembers: null, // unlimited
    maxDeploymentsPerMonth: null, // unlimited
    auditRetentionDays: 365,
    features: {
      batchDeployment: true,
      exportReports: true,
      customBranding: true,
      apiAccess: true,
      prioritySupport: true,
    },
  },
  msp: {
    maxTenants: null, // unlimited
    maxTeamMembers: null, // unlimited
    maxDeploymentsPerMonth: null, // unlimited
    auditRetentionDays: 365,
    features: {
      batchDeployment: true,
      exportReports: true,
      customBranding: true,
      apiAccess: true,
      prioritySupport: true,
    },
  },
};

// ============================================
// Feature Access Functions
// ============================================

/**
 * Get limits for a subscription tier
 */
export function getTierLimits(tier: SubscriptionTier): TierLimits {
  return tierLimits[tier] || tierLimits.free;
}

/**
 * Check if a tier has access to a feature
 */
export function hasFeatureAccess(tier: SubscriptionTier, feature: Feature): boolean {
  const limits = getTierLimits(tier);

  switch (feature) {
    case 'batch_deployment':
      return limits.features.batchDeployment;
    case 'export_reports':
      return limits.features.exportReports;
    case 'custom_branding':
      return limits.features.customBranding;
    case 'api_access':
      return limits.features.apiAccess;
    case 'priority_support':
      return limits.features.prioritySupport;
    case 'unlimited_tenants':
      return limits.maxTenants === null;
    case 'unlimited_members':
      return limits.maxTeamMembers === null;
    case 'extended_audit':
      return limits.auditRetentionDays >= 90;
    default:
      return false;
  }
}

/**
 * Check if adding a tenant would exceed the limit
 */
export function canAddTenant(tier: SubscriptionTier, currentCount: number): boolean {
  const limits = getTierLimits(tier);
  if (limits.maxTenants === null) return true;
  return currentCount < limits.maxTenants;
}

/**
 * Check if adding a team member would exceed the limit
 */
export function canAddTeamMember(tier: SubscriptionTier, currentCount: number): boolean {
  const limits = getTierLimits(tier);
  if (limits.maxTeamMembers === null) return true;
  return currentCount < limits.maxTeamMembers;
}

/**
 * Check if a deployment would exceed the monthly limit
 */
export function canDeploy(
  tier: SubscriptionTier,
  currentMonthlyDeployments: number
): boolean {
  const limits = getTierLimits(tier);
  if (limits.maxDeploymentsPerMonth === null) return true;
  return currentMonthlyDeployments < limits.maxDeploymentsPerMonth;
}

// ============================================
// Display Utilities
// ============================================

/**
 * Get display name for a tier
 */
export function getTierDisplayName(tier: SubscriptionTier): string {
  const names: Record<SubscriptionTier, string> = {
    free: 'Free',
    pro: 'Pro',
    msp: 'MSP Enterprise',
  };
  return names[tier] || tier;
}

/**
 * Get tier color for badges
 */
export function getTierColor(tier: SubscriptionTier): string {
  const colors: Record<SubscriptionTier, string> = {
    free: 'text-gray-500 bg-gray-500/10',
    pro: 'text-blue-500 bg-blue-500/10',
    msp: 'text-purple-500 bg-purple-500/10',
  };
  return colors[tier] || colors.free;
}

/**
 * Format limit for display (handles unlimited)
 */
export function formatLimit(value: number | null): string {
  return value === null ? 'Unlimited' : value.toString();
}

// ============================================
// Upgrade Recommendations
// ============================================

export interface UpgradeReason {
  reason: string;
  recommendedTier: SubscriptionTier;
  feature: Feature;
}

/**
 * Get upgrade recommendation based on usage
 */
export function getUpgradeRecommendation(
  currentTier: SubscriptionTier,
  usage: {
    tenantCount?: number;
    memberCount?: number;
    monthlyDeployments?: number;
  }
): UpgradeReason | null {
  if (currentTier === 'msp') return null; // Already at max tier

  const limits = getTierLimits(currentTier);

  // Check tenant limit
  if (
    limits.maxTenants !== null &&
    usage.tenantCount !== undefined &&
    usage.tenantCount >= limits.maxTenants
  ) {
    return {
      reason: `You've reached the maximum of ${limits.maxTenants} tenant${limits.maxTenants === 1 ? '' : 's'}`,
      recommendedTier: currentTier === 'free' ? 'pro' : 'msp',
      feature: 'unlimited_tenants',
    };
  }

  // Check member limit
  if (
    limits.maxTeamMembers !== null &&
    usage.memberCount !== undefined &&
    usage.memberCount >= limits.maxTeamMembers
  ) {
    return {
      reason: `You've reached the maximum of ${limits.maxTeamMembers} team member${limits.maxTeamMembers === 1 ? '' : 's'}`,
      recommendedTier: currentTier === 'free' ? 'pro' : 'msp',
      feature: 'unlimited_members',
    };
  }

  // Check deployment limit (warn at 80%)
  if (
    limits.maxDeploymentsPerMonth !== null &&
    usage.monthlyDeployments !== undefined &&
    usage.monthlyDeployments >= limits.maxDeploymentsPerMonth * 0.8
  ) {
    return {
      reason: `You've used ${usage.monthlyDeployments} of ${limits.maxDeploymentsPerMonth} monthly deployments`,
      recommendedTier: currentTier === 'free' ? 'pro' : 'msp',
      feature: 'batch_deployment',
    };
  }

  return null;
}

// ============================================
// Validation
// ============================================

/**
 * Check if a string is a valid tier
 */
export function isValidTier(value: string): value is SubscriptionTier {
  return ['free', 'pro', 'msp'].includes(value);
}

/**
 * Safely parse a tier, returning free as default
 */
export function parseTier(value: string | null | undefined): SubscriptionTier {
  if (!value) return 'free';
  return isValidTier(value) ? value : 'free';
}
