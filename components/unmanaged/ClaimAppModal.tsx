'use client';

import { useState } from 'react';
import { X, Monitor, Package, ShoppingCart, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm(app);
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-modal-title"
        className="relative w-full max-w-lg mx-4 bg-bg-surface rounded-2xl border border-black/10 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <h2 id="claim-modal-title" className="text-lg font-semibold text-text-primary">Claim Unmanaged App</h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
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
            <div className="bg-bg-elevated rounded-xl p-4 border border-black/5">
              <div className="flex items-center gap-2 text-text-secondary mb-1">
                <Monitor className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wide">Devices</span>
              </div>
              <p className="text-2xl font-bold text-text-primary">{app.deviceCount.toLocaleString()}</p>
            </div>
            <div className="bg-bg-elevated rounded-xl p-4 border border-black/5">
              <div className="flex items-center gap-2 text-text-secondary mb-1">
                <Package className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wide">WinGet Package</span>
              </div>
              <p className="text-sm font-mono text-accent-cyan truncate">
                {app.matchedPackageId}
              </p>
            </div>
          </div>

          {/* What happens next */}
          <div className="bg-bg-elevated/50 rounded-xl p-4 border border-black/5">
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

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/5 bg-bg-elevated/50">
          <Button variant="outline" onClick={onClose} className="border-black/10">
            Cancel
          </Button>
          <Button
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
                Add to Cart
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
