'use client';

import { ArrowUpRight, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  type SubscriptionTier,
  getTierDisplayName,
  getTierColor,
} from '@/lib/feature-flags';

interface UpgradePromptProps {
  reason: string;
  recommendedTier?: SubscriptionTier;
  currentTier?: SubscriptionTier;
  onDismiss?: () => void;
  className?: string;
}

export function UpgradePrompt({
  reason,
  recommendedTier,
  currentTier,
  onDismiss,
  className,
}: UpgradePromptProps) {
  const tierName = recommendedTier
    ? getTierDisplayName(recommendedTier)
    : 'a higher plan';

  return (
    <div
      className={cn(
        'relative p-4 rounded-xl border',
        'bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-cyan-500/10',
        'border-purple-500/20',
        className
      )}
    >
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-black/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-text-primary">Upgrade Required</h3>
            {recommendedTier && (
              <span
                className={cn(
                  'px-2 py-0.5 text-xs rounded-full font-medium',
                  getTierColor(recommendedTier)
                )}
              >
                {getTierDisplayName(recommendedTier)}
              </span>
            )}
          </div>
          <p className="text-sm text-text-secondary mb-3">{reason}</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white"
              onClick={() => {
                window.open('/pricing', '_blank');
              }}
            >
              Upgrade to {tierName}
              <ArrowUpRight className="w-4 h-4 ml-1" />
            </Button>
            {currentTier && (
              <span className="text-xs text-text-muted">
                Current: {getTierDisplayName(currentTier)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default UpgradePrompt;
