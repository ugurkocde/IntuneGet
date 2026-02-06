/**
 * Usage Limits Enforcement
 * Track and enforce usage limits based on subscription tier
 */

import { createServerClient } from '@/lib/supabase';
import {
  type SubscriptionTier,
  getTierLimits,
  canAddTenant,
  canAddTeamMember,
  canDeploy,
  getUpgradeRecommendation,
  parseTier,
} from '@/lib/feature-flags';

// ============================================
// Types
// ============================================

export interface UsageStats {
  tenantCount: number;
  memberCount: number;
  monthlyDeployments: number;
  tier: SubscriptionTier;
  limits: {
    maxTenants: number | null;
    maxTeamMembers: number | null;
    maxDeploymentsPerMonth: number | null;
  };
  canAddTenant: boolean;
  canAddMember: boolean;
  canDeploy: boolean;
  usagePercent: {
    tenants: number | null;
    members: number | null;
    deployments: number | null;
  };
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  upgradeRecommended?: boolean;
  recommendedTier?: SubscriptionTier;
}

// ============================================
// Usage Queries
// ============================================

/**
 * Get current usage stats for an organization
 */
export async function getOrganizationUsage(
  organizationId: string
): Promise<UsageStats> {
  const supabase = createServerClient();

  // Get organization tier
  // Note: subscription_tier column may not exist in all deployments
  // Use dynamic query to avoid TypeScript errors
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (supabase as any)
    .from('msp_organizations')
    .select('subscription_tier')
    .eq('id', organizationId)
    .single() as { data: { subscription_tier?: string } | null };

  const tier = parseTier(org?.subscription_tier);
  const limits = getTierLimits(tier);

  // Get tenant count
  const { count: tenantCount } = await supabase
    .from('msp_managed_tenants')
    .select('*', { count: 'exact', head: true })
    .eq('msp_organization_id', organizationId)
    .eq('is_active', true);

  // Get member count
  const { count: memberCount } = await supabase
    .from('msp_user_memberships')
    .select('*', { count: 'exact', head: true })
    .eq('msp_organization_id', organizationId);

  // Get monthly deployments from usage_metrics
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split('T')[0];

  const { data: usageData } = await supabase
    .from('usage_metrics')
    .select('count')
    .eq('organization_id', organizationId)
    .eq('metric_type', 'deployment')
    .eq('period_start', monthStart)
    .single();

  const monthlyDeployments = usageData?.count || 0;

  // Calculate percentages
  const calcPercent = (current: number, max: number | null): number | null => {
    if (max === null) return null;
    return Math.min(100, Math.round((current / max) * 100));
  };

  return {
    tenantCount: tenantCount || 0,
    memberCount: memberCount || 0,
    monthlyDeployments,
    tier,
    limits: {
      maxTenants: limits.maxTenants,
      maxTeamMembers: limits.maxTeamMembers,
      maxDeploymentsPerMonth: limits.maxDeploymentsPerMonth,
    },
    canAddTenant: canAddTenant(tier, tenantCount || 0),
    canAddMember: canAddTeamMember(tier, memberCount || 0),
    canDeploy: canDeploy(tier, monthlyDeployments),
    usagePercent: {
      tenants: calcPercent(tenantCount || 0, limits.maxTenants),
      members: calcPercent(memberCount || 0, limits.maxTeamMembers),
      deployments: calcPercent(monthlyDeployments, limits.maxDeploymentsPerMonth),
    },
  };
}

// ============================================
// Limit Enforcement
// ============================================

/**
 * Check if a tenant can be added
 */
export async function checkCanAddTenant(
  organizationId: string
): Promise<LimitCheckResult> {
  const usage = await getOrganizationUsage(organizationId);

  if (usage.canAddTenant) {
    return { allowed: true };
  }

  const recommendation = getUpgradeRecommendation(usage.tier, {
    tenantCount: usage.tenantCount,
  });

  return {
    allowed: false,
    reason: `You've reached the maximum of ${usage.limits.maxTenants} tenant${usage.limits.maxTenants === 1 ? '' : 's'} for the ${usage.tier} plan.`,
    upgradeRecommended: true,
    recommendedTier: recommendation?.recommendedTier,
  };
}

/**
 * Check if a team member can be added
 */
export async function checkCanAddMember(
  organizationId: string
): Promise<LimitCheckResult> {
  const usage = await getOrganizationUsage(organizationId);

  if (usage.canAddMember) {
    return { allowed: true };
  }

  const recommendation = getUpgradeRecommendation(usage.tier, {
    memberCount: usage.memberCount,
  });

  return {
    allowed: false,
    reason: `You've reached the maximum of ${usage.limits.maxTeamMembers} team member${usage.limits.maxTeamMembers === 1 ? '' : 's'} for the ${usage.tier} plan.`,
    upgradeRecommended: true,
    recommendedTier: recommendation?.recommendedTier,
  };
}

/**
 * Check if a deployment can be started
 */
export async function checkCanDeploy(
  organizationId: string
): Promise<LimitCheckResult> {
  const usage = await getOrganizationUsage(organizationId);

  if (usage.canDeploy) {
    // Warn if approaching limit
    const deploymentPercent = usage.usagePercent.deployments;
    if (deploymentPercent !== null && deploymentPercent >= 80) {
      return {
        allowed: true,
        reason: `You've used ${usage.monthlyDeployments} of ${usage.limits.maxDeploymentsPerMonth} monthly deployments (${deploymentPercent}%).`,
        upgradeRecommended: deploymentPercent >= 90,
      };
    }
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `You've reached the maximum of ${usage.limits.maxDeploymentsPerMonth} deployments this month for the ${usage.tier} plan.`,
    upgradeRecommended: true,
    recommendedTier: usage.tier === 'free' ? 'pro' : 'msp',
  };
}

// ============================================
// Usage Tracking
// ============================================

/**
 * Record a deployment in usage metrics
 */
export async function recordDeployment(
  organizationId: string,
  tenantId?: string
): Promise<void> {
  const supabase = createServerClient();

  try {
    await supabase.rpc('increment_usage', {
      p_org_id: organizationId,
      p_tenant_id: tenantId || null,
      p_metric_type: 'deployment',
    });
  } catch (error) {
    console.error('Error recording deployment:', error);
  }
}

/**
 * Get usage history for analytics
 */
export async function getUsageHistory(
  organizationId: string,
  months: number = 6
): Promise<Array<{ period: string; deployments: number }>> {
  const supabase = createServerClient();

  const { data } = await supabase
    .from('usage_metrics')
    .select('period_start, count')
    .eq('organization_id', organizationId)
    .eq('metric_type', 'deployment')
    .order('period_start', { ascending: false })
    .limit(months);

  return (data || []).map((row: { period_start: string; count: number }) => ({
    period: row.period_start,
    deployments: row.count,
  }));
}
