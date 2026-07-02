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
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import { useCartStore } from '@/stores/cart-store';
import { CartItemConfig } from '@/components/CartItemConfig';
import type { CartItem } from '@/types/upload';
import { isStoreCartItem, isWin32CartItem } from '@/types/upload';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { usePermissionStatus } from '@/hooks/usePermissionStatus';
import { useMspOptional } from '@/hooks/useMspOptional';
import { trackDeployment } from '@/hooks/useLandingStats';
import { PermissionStatusIndicator } from '@/components/PermissionStatusIndicator';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

interface PackagingJob {
  id: string;
  winget_id: string;
  display_name: string;
  status: string;
  github_run_url?: string;
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
  const toggleCart = useCartStore((state) => state.toggleCart);
  const closeCart = useCartStore((state) => state.closeCart);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateItem = useCartStore((state) => state.updateItem);
  const clearCart = useCartStore((state) => state.clearCart);
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  // winget id -> email of whoever already deployed it in this tenant, so we can
  // warn before a teammate's app is deployed a second time.
  const [tenantDeployedBy, setTenantDeployedBy] = useState<Map<string, string | null>>(new Map());

  const { isAuthenticated, getAccessToken, signIn, requestAdminConsent } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
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

  // Load tenant-wide deployments when the cart opens so we can flag apps a
  // teammate already deployed (non-fatal: on any failure we just skip warnings).
  useEffect(() => {
    if (!isOpen || !isAuthenticated || items.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) return;
        const response = await fetch('/api/intune/apps/deployed?scope=tenant', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
          },
        });
        if (!response.ok || cancelled) return;
        const data = await response.json();
        const map = new Map<string, string | null>();
        for (const d of (data.tenantDeployments || []) as { wingetId: string; deployedBy: string | null }[]) {
          map.set(d.wingetId, d.deployedBy);
        }
        if (!cancelled) setTenantDeployedBy(map);
      } catch {
        // Non-fatal: no warnings shown
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, isAuthenticated, items.length, getAccessToken, isMspUser, selectedTenantId]);

  // Escape key handler for sidebar
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCart();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, closeCart]);

  const handleFixPermissions = () => {
    if (permissionError === 'network_error') {
      verify();
    } else {
      requestAdminConsent();
    }
  };

  const handleDeploy = async () => {
    if (items.length === 0) return;

    trackDeployment(items.length);
    setError(null);

    if (!isAuthenticated) {
      const signedIn = await signIn();
      if (!signedIn) {
        setError('Please sign in with Microsoft to deploy packages.');
        return;
      }
    }

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
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.message || errorData.error || 'Failed to queue packaging jobs');
        }
        throw new Error(`Deployment failed (${response.status})`);
      }

      const data: PackageApiResponse = await response.json();

      if (!data.success || !data.jobs || data.jobs.length === 0) {
        throw new Error(data.message || 'No jobs were created');
      }

      const jobCount = data.jobs.length;
      const jobIds = data.jobs.map((job) => job.id).join(',');
      clearCart();
      closeCart();
      toast.success(`${jobCount} deployment${jobCount !== 1 ? 's' : ''} started`, {
        action: {
          label: 'View Progress',
          onClick: () => router.push(`/dashboard/uploads?jobs=${jobIds}`),
        },
      });
      router.push(`/dashboard/uploads?jobs=${jobIds}`);
    } catch (err) {
      console.error('Deploy error:', err);
      setError(err instanceof Error ? err.message : 'Failed to deploy packages');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleClearAll = () => {
    clearCart();
  };

  return (
    <>
      {/* Always-visible floating cart button */}
      {!isOpen && items.length > 0 && (
        <button
          onClick={toggleCart}
          aria-label={`Open cart with ${items.length} app${items.length !== 1 ? 's' : ''}`}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-accent-cyan hover:bg-accent-cyan-dim text-white shadow-lg transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="font-semibold">{items.length}</span>
        </button>
      )}

      {/* Cart sidebar */}
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="cart-title">
          {/* Backdrop with blur */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={closeCart}
            aria-hidden="true"
          />

          {/* Sidebar with slide animation */}
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-bg-surface border-l border-overlay/5 shadow-2xl flex flex-col animate-slide-in-right">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-overlay/5">
              <div className="flex items-center gap-3">
                <ShoppingCart className="w-5 h-5 text-accent-cyan" />
                <h2 id="cart-title" className="text-lg font-semibold text-text-primary">
                  Selected Apps
                </h2>
                <span className="px-2 py-0.5 bg-gradient-to-r from-accent-cyan/20 to-accent-violet/20 text-accent-cyan text-sm font-medium rounded border border-accent-cyan/20">
                  {items.length}
                </span>
              </div>
              <button
                onClick={closeCart}
                aria-label="Close cart"
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
                          iconPath={item.iconPath}
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
                            aria-label={`Edit ${item.displayName} configuration`}
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => removeItem(item.id)}
                            className="text-text-muted hover:text-status-error transition-colors p-1"
                            disabled={isDeploying}
                            aria-label={`Remove ${item.displayName} from cart`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {!isStoreCartItem(item) && (
                          <span className="px-2 py-1 bg-bg-elevated rounded text-text-primary text-xs border border-overlay/5">
                            v{item.version}
                          </span>
                        )}
                        {isStoreCartItem(item) ? (
                          <>
                            <span className="px-2 py-1 bg-violet-500/10 rounded text-violet-300 text-xs font-medium border border-violet-500/20">
                              Store
                            </span>
                            <span className="px-2 py-1 bg-bg-elevated rounded text-text-primary text-xs border border-overlay/5">
                              {item.installExperience}
                            </span>
                          </>
                        ) : isWin32CartItem(item) ? (
                          <>
                            <span className="px-2 py-1 bg-bg-elevated rounded text-text-primary text-xs border border-overlay/5">
                              {item.architecture}
                            </span>
                            <span className="px-2 py-1 bg-bg-elevated rounded text-text-primary text-xs border border-overlay/5">
                              {item.installScope}
                            </span>
                            <span className="px-2 py-1 bg-bg-elevated rounded text-text-primary text-xs uppercase border border-overlay/5">
                              {item.installerType}
                            </span>
                            {item.sourceType === 'custom' && (
                              <span className="px-2 py-1 bg-amber-500/10 rounded text-amber-300 text-xs font-medium border border-amber-500/20">
                                Custom
                              </span>
                            )}
                          </>
                        ) : null}
                        {item.forceCreate && (
                          <span className="px-2 py-1 bg-accent-cyan/10 rounded text-accent-cyan text-xs font-medium border border-accent-cyan/20 inline-flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" />
                            Redeploy
                          </span>
                        )}
                      </div>

                      {/* Teammate-duplicate warning: this app was already
                          deployed to the tenant by someone. Deploying again
                          would create a second Intune app unless forced. */}
                      {tenantDeployedBy.has(item.wingetId) && !item.forceCreate && (
                        <div className="mt-3 flex items-start gap-2 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                          <div className="text-xs flex-1">
                            <p className="text-amber-300 font-medium">Already deployed in this tenant</p>
                            <p className="text-amber-200/70 mt-0.5">
                              {tenantDeployedBy.get(item.wingetId)
                                ? `Deployed by ${tenantDeployedBy.get(item.wingetId)}. Deploying again is skipped unless you deploy as a new app.`
                                : 'Deploying again is skipped unless you deploy as a new app.'}
                            </p>
                            <button
                              onClick={() => updateItem(item.id, { forceCreate: true })}
                              disabled={isDeploying}
                              className="mt-1.5 text-amber-300 hover:text-amber-200 font-medium underline underline-offset-2"
                            >
                              Deploy as new app anyway
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="border-t border-overlay/5 p-4 space-y-4">
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
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={isDeploying}
                        className="flex-1 border-overlay/10 text-text-secondary hover:bg-overlay/5 hover:border-black/20"
                      >
                        Clear All
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear all selected apps?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove {items.length} app{items.length !== 1 ? 's' : ''} from your selection. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleClearAll}>
                          Clear All
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
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
      )}
    </>
  );
}
