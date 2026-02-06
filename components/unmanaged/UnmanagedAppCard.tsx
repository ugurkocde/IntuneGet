'use client';

import { useState, memo } from 'react';
import { Monitor, Link as LinkIcon, ShoppingCart, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import { MatchStatusBadge } from './MatchStatusBadge';
import { cn } from '@/lib/utils';
import type { UnmanagedApp } from '@/types/unmanaged';

interface UnmanagedAppCardProps {
  app: UnmanagedApp;
  onClaim?: (app: UnmanagedApp) => void;
  onLink?: (app: UnmanagedApp) => void;
  isClaimLoading?: boolean;
}

function UnmanagedAppCardComponent({
  app,
  onClaim,
  onLink,
  isClaimLoading = false,
}: UnmanagedAppCardProps) {
  const canClaim = app.matchStatus === 'matched' && !app.isClaimed;
  const canLink = app.matchStatus === 'unmatched' || app.matchStatus === 'partial';

  return (
    <div className="group glass-light rounded-xl p-5 transition-all duration-300 hover:shadow-xl hover:shadow-accent-cyan/5 hover:border-black/10">
      <div className="flex items-start gap-4">
        {/* App icon */}
        <div className="relative">
          <AppIcon
            packageId={app.matchedPackageId || app.displayName}
            packageName={app.displayName}
            size="lg"
            className="group-hover:border-accent-cyan/30 transition-all duration-300"
          />
          {app.isClaimed && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-status-success rounded-full flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-text-primary font-semibold text-base truncate group-hover:text-accent-cyan-bright transition-colors">
                {app.displayName}
              </h3>
              <p className="text-text-muted text-sm truncate">
                {app.publisher || 'Unknown publisher'}
              </p>
            </div>
            {app.version && (
              <span className="text-xs text-text-secondary bg-bg-elevated px-2.5 py-1 rounded-md flex-shrink-0 border border-black/5">
                v{app.version}
              </span>
            )}
          </div>

          {/* Device count */}
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Monitor className="w-4 h-4" />
              <span className="text-sm">
                {app.deviceCount.toLocaleString()} {app.deviceCount === 1 ? 'device' : 'devices'}
              </span>
            </div>
            <MatchStatusBadge status={app.matchStatus} confidence={app.matchConfidence} />
          </div>

          {/* Matched package info */}
          {app.matchedPackageId && (
            <p className="text-text-muted text-xs font-mono mt-2 truncate group-hover:text-text-secondary transition-colors">
              {app.matchedPackageId}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-black/5">
        <div className="flex items-center gap-2">
          {app.isClaimed && (
            <span className="text-xs text-status-success flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              Claimed
            </span>
          )}
          {app.claimStatus === 'deployed' && (
            <span className="text-xs text-status-success">Deployed</span>
          )}
          {app.claimStatus === 'deploying' && (
            <span className="text-xs text-amber-400">Deploying...</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {canLink && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onLink?.(app)}
              className="border-black/10 hover:bg-black/5 text-text-secondary"
            >
              <LinkIcon className="w-4 h-4 mr-1.5" />
              Link Package
            </Button>
          )}
          {canClaim && (
            <Button
              size="sm"
              onClick={() => onClaim?.(app)}
              disabled={isClaimLoading}
              className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-white border-0 shadow-glow-cyan"
            >
              {isClaimLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <ShoppingCart className="w-4 h-4 mr-1.5" />
                  Claim
                </>
              )}
            </Button>
          )}
          {app.isClaimed && !app.claimStatus?.includes('deploy') && (
            <Button
              size="sm"
              disabled
              className="bg-status-success/10 text-status-success cursor-default border-0"
            >
              <Check className="w-4 h-4 mr-1.5" />
              In Cart
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export const UnmanagedAppCard = memo(UnmanagedAppCardComponent, (prev, next) => {
  return (
    prev.app.discoveredAppId === next.app.discoveredAppId &&
    prev.app.displayName === next.app.displayName &&
    prev.app.publisher === next.app.publisher &&
    prev.app.version === next.app.version &&
    prev.app.deviceCount === next.app.deviceCount &&
    prev.app.matchStatus === next.app.matchStatus &&
    prev.app.matchedPackageId === next.app.matchedPackageId &&
    prev.app.matchConfidence === next.app.matchConfidence &&
    prev.app.isClaimed === next.app.isClaimed &&
    prev.app.claimStatus === next.app.claimStatus &&
    prev.isClaimLoading === next.isClaimLoading &&
    prev.onClaim === next.onClaim &&
    prev.onLink === next.onLink
  );
});
