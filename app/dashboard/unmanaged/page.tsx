'use client';

import { useMemo, useCallback } from 'react';
import Link from 'next/link';
import { T, Var } from 'gt-next';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Radar,
  Package,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  ShoppingCart,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { AnimatedStatCard, StatCardGrid } from '@/components/dashboard/AnimatedStatCard';
import {
  UnmanagedAppCard,
  ClaimAppModal,
  LinkPackageModal,
  ClaimAllModal,
} from '@/components/unmanaged';
import { UnmanagedToolbar } from '@/components/unmanaged/UnmanagedToolbar';
import { UnmanagedListRow } from '@/components/unmanaged/UnmanagedListRow';
import { UnmanagedEmptyState } from '@/components/unmanaged/UnmanagedEmptyState';
import { UnmanagedPageSkeleton } from '@/components/unmanaged/UnmanagedLoadingSkeleton';
import { useUnmanagedApps } from '@/hooks/use-unmanaged-apps';
import { staggerContainerFast, fadeUp } from '@/lib/animations/variants';
import { cn } from '@/lib/utils';

export default function UnmanagedAppsPage() {
  const {
    filteredApps,
    statusCounts,
    computedStats,
    claimableCount,
    lastSynced,
    fromCache,
    isStale,
    staleReason,
    isLoading,
    isRefreshing,
    error,
    filters,
    permissionError,
    viewMode,
    claimingAppId,
    claimModalApp,
    linkModalApp,
    claimAllModal,
    setFilters,
    setViewMode,
    setClaimModalApp,
    setLinkModalApp,
    setClaimAllModal,
    setPermissionError,
    handleRefresh,
    handleClaimApp,
    handleClaimAll,
    handleLinkPackage,
    processClaimAll,
    cancelClaimAll,
    retryFailedClaims,
    clearFilters,
  } = useUnmanagedApps();

  const prefersReducedMotion = useReducedMotion();

  // Determine empty state variant
  const emptyVariant = useMemo(() => {
    if (filteredApps.length > 0) return null;
    // Show error state when load failed and there are no apps to display
    if (error && statusCounts.all === 0) return 'error' as const;
    if (statusCounts.all === 0) return 'no-data' as const;
    if (filters.search) return 'search' as const;
    // Check all-claimed BEFORE generic filtered check:
    // When showClaimed is false and all matched apps are claimed, show success state
    const allMatchedClaimed = claimableCount === 0 && statusCounts.matched > 0;
    if (allMatchedClaimed && !filters.showClaimed) return 'all-claimed' as const;
    if (filters.matchStatus !== 'all' || !filters.showClaimed) return 'filtered' as const;
    // All apps are claimed with showClaimed: true (shouldn't reach here normally)
    if (allMatchedClaimed) return 'all-claimed' as const;
    return 'no-data' as const;
  }, [filteredApps.length, statusCounts.all, statusCounts.matched, filters, claimableCount, error]);

  // Link and Claim combined handler
  const handleLinkAndClaim = useCallback(async (app: Parameters<typeof handleLinkPackage>[0], wingetPackageId: string) => {
    await handleLinkPackage(app, wingetPackageId);
    // After linking, the app becomes matched - claim it
    const updatedApp = {
      ...app,
      matchStatus: 'matched' as const,
      matchedPackageId: wingetPackageId,
      matchConfidence: 1.0,
    };
    setClaimModalApp(updatedApp);
  }, [handleLinkPackage, setClaimModalApp]);

  // Reduced-motion-aware stagger container
  const staggerVariants = prefersReducedMotion
    ? { hidden: { opacity: 0 }, visible: { opacity: 1 } }
    : staggerContainerFast;

  const itemVariants = prefersReducedMotion
    ? { hidden: { opacity: 0 }, visible: { opacity: 1 } }
    : fadeUp;

  // Claimed percentage for stat card description
  const claimedPercentage = computedStats.matched > 0
    ? Math.round((computedStats.claimed / computedStats.matched) * 100)
    : 0;

  // Loading state
  if (isLoading) {
    return <UnmanagedPageSkeleton />;
  }

  // Permission error state
  if (permissionError) {
    return (
      <div className="space-y-8">
        <PageHeader
          title={<T>Unmanaged Apps</T>}
          description={<T>Unmanaged apps detected across your devices</T>}
          icon={Radar}
        />

        <div className="glass-light rounded-2xl p-10 border border-amber-500/20">
          <div className="flex flex-col items-center text-center max-w-lg mx-auto">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-amber-500" />
              </div>
              <div className="absolute -inset-1 rounded-2xl bg-amber-500/20 blur-xl opacity-50" />
            </div>

            <h2 className="text-2xl font-semibold text-text-primary mb-3"><T>Additional Permission Required</T></h2>
            <p className="text-text-secondary mb-8">
              <T>To access unmanaged apps, your Azure AD application needs the <Var>{permissionError}</Var> permission.</T>
            </p>

            <div className="w-full bg-bg-elevated/50 rounded-xl p-6 text-left mb-8 border border-overlay/5">
              <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent-cyan" />
                <T>Quick Setup Guide</T>
              </h3>
              <ol className="space-y-3">
                <li className="flex gap-3 text-sm text-text-secondary">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-cyan/10 text-accent-cyan flex items-center justify-center text-xs font-bold">1</span>
                  <span className="pt-0.5"><T>Go to Azure Portal &gt; App registrations &gt; Your app</T></span>
                </li>
                <li className="flex gap-3 text-sm text-text-secondary">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-cyan/10 text-accent-cyan flex items-center justify-center text-xs font-bold">2</span>
                  <span className="pt-0.5"><T>Click &quot;API permissions&quot;</T></span>
                </li>
                <li className="flex gap-3 text-sm text-text-secondary">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-cyan/10 text-accent-cyan flex items-center justify-center text-xs font-bold">3</span>
                  <span className="pt-0.5"><T>Add permission &gt; Microsoft Graph &gt; Application permissions</T></span>
                </li>
                <li className="flex gap-3 text-sm text-text-secondary">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-cyan/10 text-accent-cyan flex items-center justify-center text-xs font-bold">4</span>
                  <span className="pt-0.5"><T>Search for &quot;<Var>{permissionError}</Var>&quot; and add it</T></span>
                </li>
                <li className="flex gap-3 text-sm text-text-secondary">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-cyan/10 text-accent-cyan flex items-center justify-center text-xs font-bold">5</span>
                  <span className="pt-0.5"><T>Click &quot;Grant admin consent&quot; for your organization</T></span>
                </li>
              </ol>
            </div>

            <div className="flex gap-3">
              <a
                href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-accent-cyan to-accent-cyan-bright text-black font-medium rounded-xl hover:opacity-90 transition-opacity"
              >
                <T>Open Azure Portal</T>
                <ExternalLink className="w-4 h-4" />
              </a>
              <Button
                variant="outline"
                onClick={() => {
                  setPermissionError(null);
                  handleRefresh();
                }}
                className="border-overlay/10 hover:bg-overlay/5"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                <T>Retry</T>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={<T>Unmanaged Apps</T>}
        description={<T>Unmanaged apps detected across your devices. Claim them to enable managed deployment.</T>}
        icon={Radar}
        badge={lastSynced ? {
          text: fromCache ? 'Cached' : 'Live',
          variant: fromCache ? 'warning' : 'success',
        } : undefined}
        actions={
          <div className="flex items-center gap-3">
            {lastSynced && (
              <span className="text-xs text-text-muted">
                {new Date(lastSynced).toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="border-overlay/10 hover:bg-overlay/5 hover:border-accent-cyan/30"
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', isRefreshing && 'animate-spin')} />
              <T>Refresh</T>
            </Button>
          </div>
        }
        className="mb-0"
      />

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-start gap-3 p-4 bg-status-error/10 border border-status-error/20 rounded-lg"
          >
            <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-status-error font-medium"><T>Error</T></p>
              <p className="text-status-error/70 text-sm mt-1">{error}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="text-status-error hover:bg-status-error/10 text-xs"
            >
              <T>Retry</T>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stale data notice */}
      <AnimatePresence>
        {isStale && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-start gap-3 p-4 bg-status-warning/10 border border-status-warning/20 rounded-lg"
          >
            <AlertTriangle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-status-warning font-medium"><T>Showing cached data</T></p>
              <p className="text-status-warning/70 text-sm mt-1">
                {staleReason || <T>Live data is temporarily unavailable. Showing the last successful sync.</T>}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="text-status-warning hover:bg-status-warning/10 text-xs"
            >
              <T>Retry</T>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stat Cards (5) */}
      <StatCardGrid columns={4}>
        <AnimatedStatCard
          title={<T>Total Apps</T>}
          value={computedStats.total}
          icon={Package}
          color="cyan"
          description={<T>across <Var>{computedStats.totalDevices.toLocaleString()}</Var> devices</T>}
          delay={0}
          loading={isLoading}
        />
        <AnimatedStatCard
          title={<T>Matched</T>}
          value={computedStats.matched}
          icon={CheckCircle2}
          color="success"
          delay={0.1}
          loading={isLoading}
        />
        <AnimatedStatCard
          title={<T>Partial Match</T>}
          value={computedStats.partial}
          icon={AlertCircle}
          color="warning"
          delay={0.2}
          loading={isLoading}
        />
        <AnimatedStatCard
          title={<T>Unmatched</T>}
          value={computedStats.unmatched}
          icon={HelpCircle}
          color="neutral"
          delay={0.3}
          loading={isLoading}
        />
      </StatCardGrid>

      {/* Claimed progress card - shown as a separate row */}
      {computedStats.claimed > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <AnimatedStatCard
            title={<T>Claimed</T>}
            value={computedStats.claimed}
            icon={ShoppingCart}
            color="violet"
            description={<T><Var>{claimedPercentage}</Var>% of matched apps</T>}
            delay={0.4}
            loading={isLoading}
          />
        </div>
      )}

      {/* Post-claim navigation banner */}
      {computedStats.claimed > 0 && (
        <div className="flex items-center justify-between gap-4 px-5 py-3 rounded-xl bg-gradient-to-r from-accent-violet/5 to-emerald-500/5 border border-accent-violet/10">
          <div className="flex items-center gap-3">
            <ShoppingCart className="w-5 h-5 text-accent-violet" />
            <p className="text-sm text-text-secondary">
              <T><span className="font-medium text-text-primary"><Var>{computedStats.claimed}</Var> {computedStats.claimed === 1 ? 'app' : 'apps'}</span> in your cart ready for deployment</T>
            </p>
          </div>
          <Button asChild size="sm" className="bg-gradient-to-r from-accent-violet to-accent-violet-bright hover:opacity-90 text-white border-0 flex-shrink-0">
            <Link href="/dashboard/uploads">
              <T>Go to Deployments</T>
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Link>
          </Button>
        </div>
      )}

      {/* Toolbar */}
      <UnmanagedToolbar
        filters={filters}
        onFiltersChange={setFilters}
        statusCounts={statusCounts}
        claimableCount={claimableCount}
        filteredCount={filteredApps.length}
        totalCount={statusCounts.all}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onClaimAll={handleClaimAll}
        isClaimAllDisabled={!!claimAllModal?.isOpen}
      />

      {/* App Grid / List / Empty */}
      {emptyVariant ? (
        <UnmanagedEmptyState
          variant={emptyVariant}
          searchTerm={filters.search}
          onClearFilters={clearFilters}
          onClearSearch={() => setFilters({ ...filters, search: '' })}
          onRefresh={handleRefresh}
          onViewAll={clearFilters}
        />
      ) : viewMode === 'grid' ? (
        <motion.div
          variants={staggerVariants}
          initial="hidden"
          animate="visible"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {filteredApps.map((app) => (
            <motion.div key={app.discoveredAppId} variants={itemVariants}>
              <UnmanagedAppCard
                app={app}
                onClaim={() => setClaimModalApp(app)}
                onLink={() => setLinkModalApp(app)}
                isClaimLoading={claimingAppId === app.discoveredAppId}
              />
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <motion.div
          variants={staggerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-2"
        >
          {filteredApps.map((app) => (
            <motion.div key={app.discoveredAppId} variants={itemVariants}>
              <UnmanagedListRow
                app={app}
                onClaim={() => setClaimModalApp(app)}
                onLink={() => setLinkModalApp(app)}
                isClaimLoading={claimingAppId === app.discoveredAppId}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Modals */}
      {claimModalApp && (
        <ClaimAppModal
          app={claimModalApp}
          isOpen={!!claimModalApp}
          onClose={() => setClaimModalApp(null)}
          onConfirm={handleClaimApp}
        />
      )}

      {linkModalApp && (
        <LinkPackageModal
          app={linkModalApp}
          isOpen={!!linkModalApp}
          onClose={() => setLinkModalApp(null)}
          onLink={handleLinkPackage}
          onLinkAndClaim={handleLinkAndClaim}
        />
      )}

      {claimAllModal && (
        <ClaimAllModal
          state={claimAllModal}
          onClose={() => setClaimAllModal(null)}
          onConfirm={processClaimAll}
          onCancel={cancelClaimAll}
          onRetryFailed={retryFailedClaims}
        />
      )}
    </div>
  );
}
