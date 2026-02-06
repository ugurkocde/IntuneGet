'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  ShoppingCart,
  Trash2,
  Upload,
  ChevronRight,
  AlertCircle,
  Loader2,
  Shield,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import { useCartStore } from '@/stores/cart-store';
import { CartItemConfig } from '@/components/CartItemConfig';
import type { CartItem } from '@/types/upload';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { usePermissionStatus } from '@/hooks/usePermissionStatus';
import { trackDeployment } from '@/hooks/useLandingStats';
import { PermissionStatusIndicator } from '@/components/PermissionStatusIndicator';

interface PackagingJob {
  id: string;
  winget_id: string;
  display_name: string;
  status: string;
  pipeline_run_url?: string;
}

interface PackageApiResponse {
  success: boolean;
  jobs?: PackagingJob[];
  errors?: { wingetId: string; error: string }[];
  message?: string;
}

export function UploadCart() {
  const router = useRouter();
  const items = useCartStore((state) => state.items);
  const isOpen = useCartStore((state) => state.isOpen);
  const closeCart = useCartStore((state) => state.closeCart);
  const removeItem = useCartStore((state) => state.removeItem);
  const clearCart = useCartStore((state) => state.clearCart);
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);

  const { isAuthenticated, getAccessToken, signIn, requestAdminConsent } = useMicrosoftAuth();
  const {
    status: permissionStatus,
    error: permissionError,
    errorMessage: permissionErrorMessage,
    isChecking,
    verify,
    canDeploy,
  } = usePermissionStatus();

  // Verify permissions when cart opens
  useEffect(() => {
    if (isOpen && isAuthenticated && permissionStatus !== 'verified') {
      verify();
    }
  }, [isOpen, isAuthenticated, permissionStatus, verify]);

  const handleFixPermissions = () => {
    if (permissionError === 'network_error') {
      verify();
    } else {
      // For consent_not_granted, insufficient_intune_permissions, or missing_credentials
      requestAdminConsent();
    }
  };

  const handleDeploy = async () => {
    if (items.length === 0) return;

    // Track deployment immediately (fire-and-forget)
    trackDeployment(items.length);

    setError(null);

    // Check authentication
    if (!isAuthenticated) {
      const signedIn = await signIn();
      if (!signedIn) {
        setError('Please sign in with Microsoft to deploy packages.');
        return;
      }
    }

    // Get access token
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setError('Failed to get access token. Please sign in again.');
      return;
    }

    setIsDeploying(true);

    try {
      const response = await fetch('/api/package', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ items }),
      });

      const data: PackageApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to queue packaging jobs');
      }

      if (!data.success || !data.jobs || data.jobs.length === 0) {
        throw new Error(data.message || 'No jobs were created');
      }

      // Success - clear cart and navigate to uploads page
      const jobIds = data.jobs.map((job) => job.id).join(',');
      clearCart();
      closeCart();
      router.push(`/dashboard/uploads?jobs=${jobIds}`);
    } catch (err) {
      console.error('Deploy error:', err);
      setError(err instanceof Error ? err.message : 'Failed to deploy packages');
    } finally {
      setIsDeploying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={closeCart}
      />

      {/* Sidebar with slide animation */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-bg-surface border-l border-black/5 shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <div className="flex items-center gap-3">
            <ShoppingCart className="w-5 h-5 text-accent-cyan" />
            <h2 className="text-lg font-semibold text-text-primary">
              Selected Apps
            </h2>
            <span className="px-2 py-0.5 bg-gradient-to-r from-accent-cyan/20 to-accent-violet/20 text-accent-cyan text-sm font-medium rounded border border-accent-cyan/20">
              {items.length}
            </span>
          </div>
          <button
            onClick={closeCart}
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div className="w-16 h-16 rounded-full bg-bg-elevated flex items-center justify-center mb-4 animate-float-slow">
                <ShoppingCart className="w-8 h-8 text-text-muted" />
              </div>
              <h3 className="text-text-primary font-medium mb-1">No apps selected</h3>
              <p className="text-text-secondary text-sm">
                Select apps from the catalog to deploy to Intune
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="glass-light rounded-lg p-4 animate-fade-up"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-start gap-3">
                    <AppIcon
                      packageId={item.wingetId}
                      packageName={item.displayName}
                      size="md"
                      className="flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-text-primary font-medium truncate">
                        {item.displayName}
                      </h4>
                      <p className="text-text-muted text-sm truncate">
                        {item.publisher}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingItem(item)}
                        className="text-text-muted hover:text-accent-cyan transition-colors p-1"
                        disabled={isDeploying}
                        title="Edit configuration"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-text-muted hover:text-status-error transition-colors p-1"
                        disabled={isDeploying}
                        title="Remove from cart"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="px-2 py-1 bg-bg-elevated rounded text-text-primary text-xs border border-black/5">
                      v{item.version}
                    </span>
                    <span className="px-2 py-1 bg-bg-elevated rounded text-text-primary text-xs border border-black/5">
                      {item.architecture}
                    </span>
                    <span className="px-2 py-1 bg-bg-elevated rounded text-text-primary text-xs border border-black/5">
                      {item.installScope}
                    </span>
                    <span className="px-2 py-1 bg-bg-elevated rounded text-text-primary text-xs uppercase border border-black/5">
                      {item.installerType}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-black/5 p-4 space-y-4">
            {/* Permission status indicator */}
            {isAuthenticated && (
              <PermissionStatusIndicator
                status={permissionStatus}
                error={permissionError}
                errorMessage={permissionErrorMessage}
                onRetry={() => verify()}
                isRetrying={isChecking}
              />
            )}

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-3 p-3 bg-status-error/10 border border-status-error/20 rounded-lg">
                <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-status-error font-medium">Deployment failed</p>
                  <p className="text-status-error/70 mt-1">{error}</p>
                </div>
              </div>
            )}

            {/* Auth warning if not signed in */}
            {!isAuthenticated && (
              <div className="flex items-start gap-3 p-3 bg-accent-cyan/10 border border-accent-cyan/20 rounded-lg">
                <AlertCircle className="w-5 h-5 text-accent-cyan flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-accent-cyan font-medium">
                    Microsoft sign-in required
                  </p>
                  <p className="text-accent-cyan/70 mt-1">
                    You&apos;ll be prompted to sign in when you click Deploy.
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={clearCart}
                disabled={isDeploying}
                className="flex-1 border-black/10 text-text-secondary hover:bg-black/5 hover:border-black/20"
              >
                Clear All
              </Button>
              <Button
                onClick={isAuthenticated && !canDeploy && permissionStatus !== 'checking' ? handleFixPermissions : handleDeploy}
                disabled={isDeploying || (isAuthenticated && permissionStatus === 'checking')}
                className={`flex-1 text-white border-0 disabled:opacity-50 ${
                  isAuthenticated && !canDeploy && permissionStatus !== 'checking'
                    ? 'bg-status-error hover:bg-status-error/90'
                    : 'bg-accent-cyan hover:bg-accent-cyan-dim'
                }`}
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deploying...
                  </>
                ) : isAuthenticated && permissionStatus === 'checking' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : isAuthenticated && !canDeploy ? (
                  <>
                    <Shield className="w-4 h-4 mr-2" />
                    {permissionError === 'network_error' ? 'Retry Check' : 'Grant Permissions'}
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Deploy to Intune
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Cart Item Config Modal */}
      {editingItem && (
        <CartItemConfig
          item={editingItem}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}
