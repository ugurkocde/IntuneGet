'use client';

import { Loader2, CheckCircle2, XCircle, ShoppingCart, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { AppIcon } from '@/components/AppIcon';
import type { UnmanagedApp } from '@/types/unmanaged';

export type ClaimAllItemStatus = 'pending' | 'success' | 'failed';

export interface ClaimAllModalState {
  isOpen: boolean;
  phase: 'confirm' | 'processing';
  apps: UnmanagedApp[];
  results: Map<string, ClaimAllItemStatus>;
  isComplete: boolean;
}

interface ClaimAllModalProps {
  state: ClaimAllModalState;
  onClose: () => void;
  onConfirm: (apps: UnmanagedApp[]) => void;
  onCancel: () => void;
  onRetryFailed: () => void;
}

export function ClaimAllModal({ state, onClose, onConfirm, onCancel, onRetryFailed }: ClaimAllModalProps) {
  const { apps, results, isComplete, isOpen, phase } = state;

  const successCount = [...results.values()].filter((s) => s === 'success').length;
  const failCount = [...results.values()].filter((s) => s === 'failed').length;
  const pendingCount = [...results.values()].filter((s) => s === 'pending').length;
  const processedCount = successCount + failCount;
  const progress = apps.length > 0 ? (processedCount / apps.length) * 100 : 0;

  const isProcessing = phase === 'processing' && !isComplete;

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      if (isProcessing) return;
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md mx-4"
        hideCloseButton={isProcessing}
        onInteractOutside={(e) => {
          if (isProcessing) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isProcessing) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {phase === 'confirm'
              ? 'Claim All Matched Apps'
              : isComplete
                ? 'Claim Complete'
                : `Claiming ${apps.length} apps...`}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {phase === 'confirm'
              ? `Confirm claiming ${apps.length} matched apps`
              : `Processing ${apps.length} apps for claiming`}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-6 space-y-4">
          {/* Confirmation phase */}
          {phase === 'confirm' && (
            <>
              <div className="flex items-start gap-4 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                <ShoppingCart className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-text-primary font-medium">
                    {apps.length} {apps.length === 1 ? 'app' : 'apps'} will be claimed
                  </p>
                  <p className="text-text-secondary text-sm mt-1">
                    Each app will be fetched from WinGet and added to your deployment cart. This may take a moment.
                  </p>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {apps.map((app) => (
                  <div
                    key={app.discoveredAppId}
                    className="flex items-center gap-3 p-2 rounded-lg bg-overlay/[0.02] border border-black/[0.03]"
                  >
                    <AppIcon
                      packageId={app.matchedPackageId || app.displayName}
                      packageName={app.displayName}
                      size="sm"
                    />
                    <span className="text-sm text-text-primary truncate flex-1">
                      {app.displayName}
                    </span>
                    <span className="text-xs text-text-muted font-mono truncate max-w-[140px]">
                      {app.matchedPackageId}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Processing phase */}
          {phase === 'processing' && (
            <>
              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-text-secondary">
                  <span>
                    {processedCount} of {apps.length} processed
                  </span>
                  {pendingCount > 0 && !isComplete && (
                    <span className="text-accent-cyan">
                      {pendingCount} remaining
                    </span>
                  )}
                </div>
                <div className="h-2 bg-overlay/10 rounded-full overflow-hidden">
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
                      className="flex items-center gap-3 p-2 rounded-lg bg-overlay/[0.02] border border-black/[0.03]"
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
                <div className="text-center p-4 rounded-lg bg-overlay/[0.02] border border-black/[0.03]">
                  <p className="text-text-primary font-medium">
                    {successCount} of {apps.length} apps added to cart
                  </p>
                  {failCount > 0 && (
                    <p className="text-red-400 text-sm mt-1">
                      {failCount} failed - you can retry these individually
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          {phase === 'confirm' && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="border-overlay/10"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => onConfirm(apps)}
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white border-0"
              >
                <ShoppingCart className="w-4 h-4 mr-2" />
                Claim {apps.length} Apps
              </Button>
            </>
          )}

          {phase === 'processing' && !isComplete && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="w-full border-overlay/10"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              Cancel Remaining
            </Button>
          )}

          {phase === 'processing' && isComplete && (
            <div className="flex gap-3 w-full">
              {failCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onRetryFailed}
                  className="border-overlay/10"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry Failed ({failCount})
                </Button>
              )}
              <Button
                type="button"
                onClick={onClose}
                className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white border-0"
              >
                Done
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
