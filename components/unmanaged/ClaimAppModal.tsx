'use client';

import { useState } from 'react';
import { Monitor, Package, ShoppingCart, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
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

interface ClaimAppModalProps {
  app: UnmanagedApp;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (app: UnmanagedApp) => Promise<void>;
}

export function ClaimAppModal({ app, isOpen, onClose, onConfirm }: ClaimAppModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onConfirm(app);
      // Modal close is handled by the parent on success
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to claim app. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isLoading) {
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-lg mx-4"
        onInteractOutside={(e) => {
          if (isLoading) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Claim Unmanaged App</DialogTitle>
          <DialogDescription className="sr-only">
            Add {app.displayName} to your deployment cart
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-6">
          {/* App info */}
          <div className="flex items-center gap-4 mb-6">
            <AppIcon
              packageId={app.matchedPackageId || app.displayName}
              packageName={app.displayName}
              size="xl"
            />
            <div className="flex-1 min-w-0">
              <h3 className="text-text-primary font-semibold text-lg truncate">{app.displayName}</h3>
              <p className="text-text-secondary text-sm">{app.publisher || 'Unknown publisher'}</p>
              {app.version && (
                <p className="text-text-muted text-xs mt-1">Current version: {app.version}</p>
              )}
            </div>
          </div>

          {/* Info cards */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-bg-elevated rounded-xl p-4 border border-overlay/5">
              <div className="flex items-center gap-2 text-text-secondary mb-1">
                <Monitor className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wide">Devices</span>
              </div>
              <p className="text-2xl font-bold text-text-primary">{app.deviceCount.toLocaleString()}</p>
            </div>
            <div className="bg-bg-elevated rounded-xl p-4 border border-overlay/5">
              <div className="flex items-center gap-2 text-text-secondary mb-1">
                <Package className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wide">WinGet Package</span>
              </div>
              <p className="text-sm font-mono text-accent-cyan truncate">
                {app.matchedPackageId}
              </p>
            </div>
          </div>

          {/* Error state */}
          {error && (
            <div className="flex items-start gap-3 p-4 mb-6 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">Failed to claim app</p>
                <p className="text-sm text-red-400/80 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* What happens next */}
          <div className="bg-bg-elevated/50 rounded-xl p-4 border border-overlay/5">
            <h4 className="text-sm font-medium text-text-primary mb-3">What happens next?</h4>
            <ul className="space-y-2">
              <li className="flex items-start gap-2 text-sm text-text-secondary">
                <CheckCircle2 className="w-4 h-4 text-status-success flex-shrink-0 mt-0.5" />
                <span>The WinGet package will be added to your cart</span>
              </li>
              <li className="flex items-start gap-2 text-sm text-text-secondary">
                <CheckCircle2 className="w-4 h-4 text-status-success flex-shrink-0 mt-0.5" />
                <span>You can configure deployment options before uploading</span>
              </li>
              <li className="flex items-start gap-2 text-sm text-text-secondary">
                <CheckCircle2 className="w-4 h-4 text-status-success flex-shrink-0 mt-0.5" />
                <span>After deployment, this app will become managed in Intune</span>
              </li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
            className="border-overlay/10"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading}
            className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-white border-0"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Adding to Cart...
              </>
            ) : (
              <>
                <ShoppingCart className="w-4 h-4 mr-2" />
                {error ? 'Retry' : 'Add to Cart'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
