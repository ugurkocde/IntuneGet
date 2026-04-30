'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ShoppingCart,
  AlertTriangle,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { T } from 'gt-next';
import { Button } from '@/components/ui/button';
import { Toaster } from 'sonner';
import { useCartStore } from '@/stores/cart-store';
import { useSidebarStore } from '@/stores/sidebar-store';
import { useProfileStore } from '@/stores/profile-store';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { TenantSwitcher } from '@/components/msp';
import { UploadCart } from '@/components/UploadCart';
import { NotificationBell } from '@/components/notifications';
import { Sidebar, DeploymentStatusIndicator } from '@/components/dashboard';
import { CommandPalette } from '@/components/dashboard/CommandPalette';
import { springPresets } from '@/lib/animations/variants';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isSigningOut, user, signOut, getAccessToken } = useMicrosoftAuth();
  const {
    isOnboardingComplete,
    isChecking: isCheckingOnboarding,
    errorType,
    retryVerification,
  } = useOnboardingStatus();
  const router = useRouter();
  const isCollapsed = useSidebarStore((state) => state.isCollapsed);
  const fetchProfileImage = useProfileStore((state) => state.fetchProfileImage);
  const prefersReducedMotion = useReducedMotion();
  const [isLoading, setIsLoading] = useState(true);
  const [showRetryBanner, setShowRetryBanner] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const cartItemCount = useCartStore((state) => state.getItemCount());
  const toggleCart = useCartStore((state) => state.toggleCart);

  const handleOpenCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, []);

  useKeyboardShortcuts({
    onCommandPalette: handleOpenCommandPalette,
    onToggleCart: toggleCart,
  });

  useEffect(() => {
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isSigningOut) {
      router.push('/auth/signin?callbackUrl=/dashboard');
    }
  }, [isLoading, isAuthenticated, isSigningOut, router]);

  useEffect(() => {
    if (isLoading || !isAuthenticated || isCheckingOnboarding) return;

    if (isOnboardingComplete) {
      setShowRetryBanner(false);
      return;
    }

    // Only act on a definitive errorType. errorType=null + !isOnboardingComplete
    // is a transient state during MSAL hydration / verification — redirecting
    // here would push known-good users to /onboarding on browser refresh.
    if (errorType === null) return;

    if (
      errorType === 'network_error' ||
      errorType === 'missing_credentials' ||
      errorType === 'consent_propagating'
    ) {
      // Consent may already be granted (propagating) or the failure is
      // transient. Keep the user on the dashboard with a retry banner
      // rather than bouncing them to the onboarding re-consent flow.
      setShowRetryBanner(true);
      return;
    }

    // consent_not_granted or insufficient_intune_permissions: real consent gap.
    router.push('/onboarding');
  }, [isLoading, isAuthenticated, isCheckingOnboarding, isOnboardingComplete, errorType, router]);

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      getAccessToken().then((token) => {
        if (token) {
          fetchProfileImage(token);
        }
      });
    }
  }, [isAuthenticated, isLoading, getAccessToken, fetchProfileImage]);

  const handleRetry = async () => {
    setIsRetrying(true);
    await retryVerification();
    setIsRetrying(false);
  };

  const handleSignOut = async () => {
    await signOut();
  };

  if (isLoading || isCheckingOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-deepest">
        <div className="relative">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-accent-cyan/20 border-t-accent-cyan"></div>
          <div className="absolute inset-0 rounded-full blur-xl bg-accent-cyan/20 animate-pulse-glow"></div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || (!isOnboardingComplete && !showRetryBanner)) {
    return null;
  }

  return (
    <div className="min-h-screen bg-bg-deepest bg-grid-light">
      {/* Ambient glow elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-accent-cyan/8 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-accent-violet/8 rounded-full blur-3xl" />
      </div>

      {/* Sidebar */}
      <Sidebar user={user} onSignOut={handleSignOut} />

      {/* Main content */}
      <motion.div
        initial={false}
        animate={{
          paddingLeft: isCollapsed ? 72 : 256,
        }}
        transition={prefersReducedMotion ? { duration: 0 } : springPresets.snappy}
        className="max-lg:!pl-0"
      >
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-16 glass-light">
          <div className="flex items-center justify-between h-full px-4 lg:px-6">
            {/* Command palette trigger */}
            <button
              onClick={handleOpenCommandPalette}
              className="hidden lg:flex items-center gap-2 px-3 py-1.5 text-sm text-text-muted hover:text-text-secondary bg-overlay/[0.03] hover:bg-overlay/5 rounded-lg border border-overlay/5 transition-colors"
            >
              <span><T>Search...</T></span>
              <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-overlay/10 rounded border border-overlay/5">
                <span className="text-xs"><T>Cmd</T></span><T>K</T>
              </kbd>
            </button>
            <div className="flex-1 lg:hidden" />

            <div className="flex items-center gap-3">
              <TenantSwitcher />
              <DeploymentStatusIndicator />
              <NotificationBell />
              <Button
                variant="ghost"
                onClick={toggleCart}
                className="relative text-text-secondary hover:text-text-primary hover:bg-overlay/5 transition-all"
              >
                <ShoppingCart className="w-5 h-5" />
                {cartItemCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-r from-accent-cyan to-accent-violet text-bg-elevated text-xs font-medium rounded-full flex items-center justify-center shadow-glow-cyan animate-scale-in">
                    {cartItemCount}
                  </span>
                )}
              </Button>
            </div>
          </div>
        </header>

        {/* Consent Verification Retry Banner */}
        {showRetryBanner && errorType === 'consent_propagating' && (
          <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 lg:px-6 py-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <Loader2 className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5 sm:mt-0 animate-spin" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-blue-200">
                    <T>Finalizing organization setup</T>
                  </p>
                  <p className="text-xs text-blue-200/70">
                    <T>Admin consent was granted. Microsoft is still propagating permissions (5-15 minutes).</T>
                  </p>
                </div>
              </div>
              <Button
                onClick={handleRetry}
                disabled={isRetrying}
                size="sm"
                className="bg-blue-500 hover:bg-blue-600 text-white font-medium flex-shrink-0 w-full sm:w-auto"
              >
                {isRetrying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    <T>Checking...</T>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    <T>Check Again</T>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {showRetryBanner && errorType !== 'consent_propagating' && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 lg:px-6 py-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5 sm:mt-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-200">
                    <T>Unable to verify organization setup</T>
                  </p>
                  <p className="text-xs text-amber-200/70">
                    {errorType === 'missing_credentials'
                      ? <T>Server configuration issue. Contact your administrator.</T>
                      : <T>Please check your connection and try again.</T>}
                  </p>
                </div>
              </div>
              <Button
                onClick={handleRetry}
                disabled={isRetrying}
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-black font-medium flex-shrink-0 w-full sm:w-auto"
              >
                {isRetrying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    <T>Retrying...</T>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    <T>Retry</T>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Page content */}
        <main className="p-4 lg:p-6 relative">
          {children}
        </main>
      </motion.div>

      {/* Upload Cart Sidebar */}
      <UploadCart />

      {/* Command Palette */}
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

      {/* Toast notifications */}
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          className: 'bg-bg-surface border border-overlay/10 text-text-primary',
        }}
      />
    </div>
  );
}
