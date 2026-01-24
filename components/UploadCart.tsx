'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  ShoppingCart,
  Trash2,
  Upload,
  Package,
  ChevronRight,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/stores/cart-store';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';

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

  const { isAuthenticated, getAccessToken, signIn } = useMicrosoftAuth();

  const handleDeploy = async () => {
    if (items.length === 0) return;
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
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-bg-surface border-l border-white/5 shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <ShoppingCart className="w-5 h-5 text-accent-cyan" />
            <h2 className="text-lg font-semibold text-white">
              Selected Apps
            </h2>
            <span className="px-2 py-0.5 bg-gradient-to-r from-accent-cyan/20 to-accent-violet/20 text-accent-cyan text-sm font-medium rounded border border-accent-cyan/20">
              {items.length}
            </span>
          </div>
          <button
            onClick={closeCart}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div className="w-16 h-16 rounded-full bg-bg-elevated flex items-center justify-center mb-4 animate-float-slow">
                <ShoppingCart className="w-8 h-8 text-zinc-600" />
              </div>
              <h3 className="text-white font-medium mb-1">No apps selected</h3>
              <p className="text-zinc-400 text-sm">
                Select apps from the catalog to deploy to Intune
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="glass-dark rounded-lg p-4 animate-fade-up"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-bg-elevated to-bg-surface flex items-center justify-center flex-shrink-0 border border-white/5">
                      <Package className="w-5 h-5 text-zinc-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-white font-medium truncate">
                        {item.displayName}
                      </h4>
                      <p className="text-zinc-500 text-sm truncate">
                        {item.publisher}
                      </p>
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-zinc-500 hover:text-status-error transition-colors"
                      disabled={isDeploying}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="px-2 py-1 bg-bg-elevated rounded text-zinc-300 text-xs border border-white/5">
                      v{item.version}
                    </span>
                    <span className="px-2 py-1 bg-bg-elevated rounded text-zinc-300 text-xs border border-white/5">
                      {item.architecture}
                    </span>
                    <span className="px-2 py-1 bg-bg-elevated rounded text-zinc-300 text-xs border border-white/5">
                      {item.installScope}
                    </span>
                    <span className="px-2 py-1 bg-bg-elevated rounded text-zinc-300 text-xs uppercase border border-white/5">
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
          <div className="border-t border-white/5 p-4 space-y-4">
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

            {/* Warning */}
            <div className="flex items-start gap-3 p-3 bg-status-warning/10 border border-status-warning/20 rounded-lg">
              <AlertCircle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="text-status-warning font-medium">
                  Deployment will start immediately
                </p>
                <p className="text-status-warning/70 mt-1">
                  Packages will be processed via Azure DevOps and uploaded to your Intune tenant.
                </p>
              </div>
            </div>

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
                className="flex-1 border-zinc-700 text-zinc-300 hover:bg-white/5 hover:border-zinc-600"
              >
                Clear All
              </Button>
              <Button
                onClick={handleDeploy}
                disabled={isDeploying}
                className="flex-1 bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-white border-0 shadow-glow-cyan"
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deploying...
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
    </div>
  );
}
