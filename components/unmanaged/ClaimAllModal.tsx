'use client';

import { Loader2, CheckCircle2, XCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import type { UnmanagedApp } from '@/types/unmanaged';

export type ClaimStatus = 'pending' | 'success' | 'failed';

export interface ClaimAllModalState {
  isOpen: boolean;
  apps: UnmanagedApp[];
  results: Map<string, ClaimStatus>;
  isComplete: boolean;
}

interface ClaimAllModalProps {
  state: ClaimAllModalState;
  onClose: () => void;
}

export function ClaimAllModal({ state, onClose }: ClaimAllModalProps) {
  const { apps, results, isComplete, isOpen } = state;

  if (!isOpen) return null;

  const successCount = [...results.values()].filter((s) => s === 'success').length;
  const failCount = [...results.values()].filter((s) => s === 'failed').length;
  const pendingCount = [...results.values()].filter((s) => s === 'pending').length;
  const processedCount = successCount + failCount;
  const progress = apps.length > 0 ? (processedCount / apps.length) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop - only clickable when complete */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={isComplete ? onClose : undefined}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-all-modal-title"
        aria-busy={!isComplete}
        className="relative w-full max-w-md mx-4 bg-bg-surface rounded-2xl border border-black/10 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <h2 id="claim-all-modal-title" className="text-lg font-semibold text-text-primary">
            {isComplete ? 'Claim Complete' : `Claiming ${apps.length} apps...`}
          </h2>
          {isComplete && (
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary transition-colors p-1"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-text-secondary">
              <span>
                {processedCount} of {apps.length} processed
              </span>
              {pendingCount > 0 && (
                <span className="text-accent-cyan">
                  {pendingCount} in progress
                </span>
              )}
            </div>
            <div className="h-2 bg-black/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* App list with status */}
          <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
            {apps.map((app) => {
              const status = results.get(app.discoveredAppId);
              return (
                <div
                  key={app.discoveredAppId}
                  className="flex items-center gap-3 p-2 rounded-lg bg-black/[0.02] border border-black/[0.03]"
                >
                  <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                    {status === 'pending' && (
                      <Loader2 className="w-4 h-4 text-accent-cyan animate-spin" />
                    )}
                    {status === 'success' && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    )}
                    {status === 'failed' && (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                  </div>
                  <AppIcon
                    packageId={app.matchedPackageId || app.displayName}
                    packageName={app.displayName}
                    size="sm"
                  />
                  <span className="text-sm text-text-primary truncate flex-1">
                    {app.displayName}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          {isComplete && (
            <div className="text-center p-4 rounded-lg bg-black/[0.02] border border-black/[0.03]">
              <p className="text-text-primary font-medium">
                {successCount} of {apps.length} apps added to cart
              </p>
              {failCount > 0 && (
                <p className="text-red-400 text-sm mt-1">
                  {failCount} failed - these apps may need to be claimed individually
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-black/5 bg-bg-elevated/50">
          <Button
            onClick={onClose}
            disabled={!isComplete}
            className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white border-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isComplete ? 'Close' : 'Processing...'}
          </Button>
        </div>
      </div>
    </div>
  );
}
