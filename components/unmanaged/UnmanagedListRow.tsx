'use client';

import { memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Monitor,
  ShoppingCart,
  Link as LinkIcon,
  Loader2,
  CheckCircle2,
  Lightbulb,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import { MatchStatusBadge } from './MatchStatusBadge';
import { cn } from '@/lib/utils';
import type { UnmanagedApp } from '@/types/unmanaged';

interface UnmanagedListRowProps {
  app: UnmanagedApp;
  onClaim: () => void;
  onLink: () => void;
  isClaimLoading: boolean;
}

const statusBorderColor: Record<string, string> = {
  matched: 'border-l-emerald-500',
  partial: 'border-l-amber-500',
  unmatched: 'border-l-zinc-500',
  pending: 'border-l-blue-500',
};

export const UnmanagedListRow = memo(function UnmanagedListRow({
  app,
  onClaim,
  onLink,
  isClaimLoading,
}: UnmanagedListRowProps) {
  const prefersReducedMotion = useReducedMotion();
  const canClaim = app.matchStatus === 'matched' && !app.isClaimed;
  const canLink = app.matchStatus === 'unmatched' || app.matchStatus === 'partial';
  const hasPartialSuggestions = app.partialMatches && app.partialMatches.length > 0;

  return (
    <motion.div
      whileHover={prefersReducedMotion ? {} : { scale: 1.005, y: -1 }}
      whileTap={prefersReducedMotion ? {} : { scale: 0.995 }}
      transition={{ duration: 0.15 }}
      className="group relative"
    >
      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-black/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <div
        className={cn(
          'relative flex items-center gap-4 p-4 rounded-xl bg-overlay/[0.02] border border-black/[0.03] group-hover:border-overlay/10 transition-all duration-200 border-l-[3px]',
          statusBorderColor[app.matchStatus] || 'border-l-transparent',
          app.isClaimed && 'opacity-70 group-hover:opacity-100'
        )}
      >
        {/* App icon */}
        <div className="relative flex-shrink-0">
          <AppIcon
            packageId={app.matchedPackageId || app.displayName}
            packageName={app.displayName}
            size="md"
            className="group-hover:scale-105 transition-transform duration-200"
          />
          {app.isClaimed && (
            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center ring-2 ring-bg-surface">
              <CheckCircle2 className="w-2.5 h-2.5 text-white" />
            </div>
          )}
        </div>

        {/* App info */}
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[1fr,auto,auto,auto] gap-2 sm:gap-4 items-center">
          <div className="min-w-0">
            <h3 className="text-text-primary font-medium truncate group-hover:text-accent-cyan-bright transition-colors">
              {app.displayName}
            </h3>
            <div className="flex items-center gap-2">
              <p className="text-text-muted text-sm truncate">{app.publisher || 'Unknown publisher'}</p>
              {hasPartialSuggestions && canLink && (
                <button
                  type="button"
                  onClick={onLink}
                  className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors flex-shrink-0"
                >
                  <Lightbulb className="w-3 h-3" />
                  {app.partialMatches!.length}
                </button>
              )}
            </div>
          </div>

          {/* Device count */}
          <div className="flex items-center gap-2 text-text-secondary">
            <Monitor className="w-4 h-4" />
            <span className="text-sm font-semibold tabular-nums">{app.deviceCount.toLocaleString()}</span>
          </div>

          {/* Status badge */}
          <MatchStatusBadge status={app.matchStatus} confidence={app.matchConfidence} />

          {/* Actions */}
          <div className="flex items-center gap-2">
            {canLink && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onLink}
                className="h-8 px-3 text-text-secondary hover:text-text-primary border-overlay/10 hover:bg-overlay/5"
              >
                <LinkIcon className="w-4 h-4 mr-1.5" />
                <span className="hidden lg:inline">Link</span>
              </Button>
            )}
            {canClaim && (
              <Button
                type="button"
                size="sm"
                onClick={onClaim}
                disabled={isClaimLoading}
                className="h-8 px-4 bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-white border-0"
              >
                {isClaimLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />
                    Claim
                  </>
                )}
              </Button>
            )}
            {app.isClaimed && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Claimed
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
});
