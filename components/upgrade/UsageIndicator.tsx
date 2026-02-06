'use client';

import { cn } from '@/lib/utils';
import {
  type SubscriptionTier,
  getTierDisplayName,
  formatLimit,
} from '@/lib/feature-flags';

interface UsageIndicatorProps {
  label: string;
  current: number;
  max: number | null;
  tier?: SubscriptionTier;
  showUpgrade?: boolean;
  className?: string;
}

export function UsageIndicator({
  label,
  current,
  max,
  tier,
  showUpgrade = false,
  className,
}: UsageIndicatorProps) {
  const isUnlimited = max === null;
  const percentage = isUnlimited ? 0 : Math.min(100, Math.round((current / max) * 100));
  const isNearLimit = !isUnlimited && percentage >= 80;
  const isAtLimit = !isUnlimited && percentage >= 100;

  const getBarColor = () => {
    if (isUnlimited) return 'bg-accent-cyan';
    if (isAtLimit) return 'bg-red-500';
    if (isNearLimit) return 'bg-yellow-500';
    return 'bg-accent-cyan';
  };

  const getTextColor = () => {
    if (isAtLimit) return 'text-red-500';
    if (isNearLimit) return 'text-yellow-500';
    return 'text-text-secondary';
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        <span className={cn('text-sm', getTextColor())}>
          {current} / {formatLimit(max)}
          {!isUnlimited && ` (${percentage}%)`}
        </span>
      </div>

      <div className="h-2 bg-black/10 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            getBarColor()
          )}
          style={{ width: isUnlimited ? '100%' : `${percentage}%` }}
        />
      </div>

      {isAtLimit && showUpgrade && (
        <p className="text-xs text-red-400">
          Limit reached. Upgrade to {tier === 'free' ? 'Pro' : 'MSP'} for more.
        </p>
      )}

      {isNearLimit && !isAtLimit && showUpgrade && (
        <p className="text-xs text-yellow-500">
          Approaching limit. Consider upgrading.
        </p>
      )}

      {isUnlimited && tier && (
        <p className="text-xs text-text-muted">
          Unlimited on {getTierDisplayName(tier)}
        </p>
      )}
    </div>
  );
}

interface UsageDashboardProps {
  usage: {
    tenantCount: number;
    memberCount: number;
    monthlyDeployments: number;
    tier: SubscriptionTier;
    limits: {
      maxTenants: number | null;
      maxTeamMembers: number | null;
      maxDeploymentsPerMonth: number | null;
    };
  };
  className?: string;
}

export function UsageDashboard({ usage, className }: UsageDashboardProps) {
  return (
    <div className={cn('space-y-4 p-4 bg-black/5 rounded-xl', className)}>
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-text-primary">Usage</h3>
        <span
          className={cn(
            'px-2 py-0.5 text-xs rounded-full',
            usage.tier === 'free'
              ? 'text-gray-500 bg-gray-500/10'
              : usage.tier === 'pro'
              ? 'text-blue-500 bg-blue-500/10'
              : 'text-purple-500 bg-purple-500/10'
          )}
        >
          {getTierDisplayName(usage.tier)}
        </span>
      </div>

      <UsageIndicator
        label="Managed Tenants"
        current={usage.tenantCount}
        max={usage.limits.maxTenants}
        tier={usage.tier}
        showUpgrade
      />

      <UsageIndicator
        label="Team Members"
        current={usage.memberCount}
        max={usage.limits.maxTeamMembers}
        tier={usage.tier}
        showUpgrade
      />

      <UsageIndicator
        label="Monthly Deployments"
        current={usage.monthlyDeployments}
        max={usage.limits.maxDeploymentsPerMonth}
        tier={usage.tier}
        showUpgrade
      />
    </div>
  );
}

export default UsageIndicator;
