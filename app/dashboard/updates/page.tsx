'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Package,
  History,
  Search,
  XCircle,
  ArrowUpDown,
  Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { PageHeader, AnimatedStatCard, StatCardGrid, AnimatedEmptyState } from '@/components/dashboard';
import { UpdateCard, UpdateCardSkeleton, AutoUpdateHistory } from '@/components/updates';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useAvailableUpdates,
  useAutoUpdateHistory,
  useRefreshAvailableUpdates,
  useTriggerUpdate,
  useUpdatePolicy,
} from '@/hooks/use-updates';
import { useMspOptional } from '@/hooks/useMspOptional';
import { fadeIn } from '@/lib/animations/variants';
import { cn } from '@/lib/utils';
import { classifyUpdateType } from '@/types/update-policies';
import type { AvailableUpdate, UpdatePolicyType, UpdateType } from '@/types/update-policies';

type SortOption = 'name' | 'severity' | 'type' | 'detected';

const sortLabels: Record<SortOption, string> = {
  name: 'Name (A-Z)',
  severity: 'Critical first',
  type: 'Major first',
  detected: 'Oldest first',
};

export default function UpdatesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);
  const [updateTypeFilter, setUpdateTypeFilter] = useState<UpdateType | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('severity');
  const [activeTab, setActiveTab] = useState<'available' | 'history'>('available');
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const shouldReduceMotion = useReducedMotion();
  const { isMspUser, selectedTenantId, managedTenants } = useMspOptional();
  const tenantId = isMspUser ? selectedTenantId || undefined : undefined;
  const hasGrantedManagedTenants = managedTenants.some(
    (tenant) => tenant.is_active && tenant.consent_status === 'granted' && Boolean(tenant.tenant_id)
  );
  const mspTenantSelectionRequired = isMspUser && hasGrantedManagedTenants && !selectedTenantId;

  // Data hooks
  const {
    data: updatesData,
    isLoading: isLoadingUpdates,
    error: updatesError,
    refetch: refetchUpdates,
    isFetching: isFetchingUpdates,
  } = useAvailableUpdates({
    tenantId,
    criticalOnly: showCriticalOnly,
  });

  const {
    data: historyData,
    isLoading: isLoadingHistory,
    fetchMore: fetchMoreHistory,
    hasMore: hasMoreHistory,
  } = useAutoUpdateHistory({ tenantId });

  const { refreshUpdates, isRefreshing } = useRefreshAvailableUpdates({ tenantId });
  const { triggerUpdate } = useTriggerUpdate();
  const { updatePolicy } = useUpdatePolicy();

  const updates = updatesData?.updates || [];
  const history = historyData?.history || [];

  // Filter and sort updates
  const filteredUpdates = useMemo(() => {
    let result = updates;

    // Search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (update) =>
          update.display_name.toLowerCase().includes(searchLower) ||
          update.winget_id.toLowerCase().includes(searchLower)
      );
    }

    // Update type filter
    if (updateTypeFilter) {
      result = result.filter((update) => {
        const type = classifyUpdateType(update.current_version, update.latest_version);
        return type === updateTypeFilter;
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.display_name.localeCompare(b.display_name);
        case 'severity': {
          // Critical first, then by name
          if (a.is_critical !== b.is_critical) return a.is_critical ? -1 : 1;
          return a.display_name.localeCompare(b.display_name);
        }
        case 'type': {
          // Major > Minor > Patch
          const typeOrder: Record<string, number> = { major: 0, minor: 1, patch: 2 };
          const aType = classifyUpdateType(a.current_version, a.latest_version);
          const bType = classifyUpdateType(b.current_version, b.latest_version);
          const diff = typeOrder[aType] - typeOrder[bType];
          return diff !== 0 ? diff : a.display_name.localeCompare(b.display_name);
        }
        case 'detected':
          return new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime();
        default:
          return 0;
      }
    });

    return result;
  }, [updates, search, updateTypeFilter, sortBy]);

  // Stats
  const availableCount = updates.length;
  const criticalCount = updates.filter((u) => u.is_critical).length;
  const autoUpdateCount = updates.filter(
    (u) => u.policy?.policy_type === 'auto_update' && u.policy?.is_enabled
  ).length;
  const recentAutoUpdates = history.filter(
    (h) => h.status === 'completed' && isWithinDays(h.completed_at, 7)
  ).length;
  const failedUpdates = history.filter(
    (h) => h.status === 'failed' && isWithinDays(h.triggered_at, 7)
  ).length;

  // Eligible updates for bulk action (exclude ignore and pinned)
  const eligibleForBulkUpdate = filteredUpdates.filter(
    (u) => u.policy?.policy_type !== 'ignore' && u.policy?.policy_type !== 'pin_version'
  );

  // Update type counts for filter
  const updateTypeCounts = useMemo(() => {
    const counts = { major: 0, minor: 0, patch: 0 };
    for (const u of updates) {
      const type = classifyUpdateType(u.current_version, u.latest_version);
      counts[type]++;
    }
    return counts;
  }, [updates]);

  // Oldest critical update age
  const oldestCriticalAge = (() => {
    const criticals = updates.filter((u) => u.is_critical);
    if (criticals.length === 0) return null;
    const oldest = criticals.reduce((prev, curr) =>
      new Date(prev.detected_at) < new Date(curr.detected_at) ? prev : curr
    );
    const days = Math.floor(
      (Date.now() - new Date(oldest.detected_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (days === 0) return 'detected today';
    if (days === 1) return 'oldest: 1 day ago';
    return `oldest: ${days} days ago`;
  })();

  // Handlers
  const handleTriggerUpdate = useCallback(async (update: AvailableUpdate) => {
    setUpdatingIds((prev) => new Set(prev).add(update.id));
    try {
      await triggerUpdate({
        winget_id: update.winget_id,
        tenant_id: update.tenant_id,
      });
      router.push('/dashboard/uploads');
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(update.id);
        return next;
      });
    }
  }, [triggerUpdate, router]);

  const handlePolicyChange = useCallback(async (
    update: AvailableUpdate,
    policyType: UpdatePolicyType
  ) => {
    try {
      await updatePolicy({
        winget_id: update.winget_id,
        tenant_id: update.tenant_id,
        policy_type: policyType,
      });
      refetchUpdates();
    } catch {
      // Policy update failed; don't refetch stale data
    }
  }, [updatePolicy, refetchUpdates]);

  const handleBulkUpdate = useCallback(async () => {
    // Mark all eligible updates as updating at once
    setUpdatingIds(new Set(eligibleForBulkUpdate.map((u) => u.id)));

    try {
      // Use bulk API - batch into groups of 10 (API limit)
      const batchSize = 10;
      for (let i = 0; i < eligibleForBulkUpdate.length; i += batchSize) {
        const batch = eligibleForBulkUpdate.slice(i, i + batchSize);
        await triggerUpdate({
          updates: batch.map((u) => ({
            winget_id: u.winget_id,
            tenant_id: u.tenant_id,
          })),
        });
      }
      router.push('/dashboard/uploads');
    } finally {
      setUpdatingIds(new Set());
    }
  }, [eligibleForBulkUpdate, triggerUpdate, router]);

  const handleRefresh = useCallback(async () => {
    await refreshUpdates();
    await refetchUpdates();
  }, [refreshUpdates, refetchUpdates]);

  // Auto-refresh when initial load returns empty results
  const hasTriggeredAutoRefresh = useRef(false);
  useEffect(() => {
    if (
      !isLoadingUpdates &&
      !isRefreshing &&
      !hasTriggeredAutoRefresh.current &&
      !mspTenantSelectionRequired &&
      updates.length === 0
    ) {
      hasTriggeredAutoRefresh.current = true;
      void handleRefresh();
    }
  }, [isLoadingUpdates, isRefreshing, mspTenantSelectionRequired, updates.length, handleRefresh]);

  // Check if any filters are active
  const hasActiveFilters = search.trim() !== '' || showCriticalOnly || updateTypeFilter !== null;

  const clearAllFilters = () => {
    setSearch('');
    setShowCriticalOnly(false);
    setUpdateTypeFilter(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="App Updates"
        description="Manage app updates and auto-update policies"
        gradient
        gradientColors="cyan"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                void handleRefresh();
              }}
              disabled={isFetchingUpdates || isRefreshing}
              className="text-text-secondary hover:text-text-primary"
            >
              <RefreshCw
                className={cn(
                  'w-4 h-4 mr-2',
                  (isFetchingUpdates || isRefreshing) && 'animate-spin'
                )}
              />
              Refresh
            </Button>
            {eligibleForBulkUpdate.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="bg-accent-cyan hover:bg-accent-cyan-bright text-bg-deepest font-medium">
                    Update All ({eligibleForBulkUpdate.length})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-bg-surface border-overlay/10">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-text-primary">
                      Update {eligibleForBulkUpdate.length} app{eligibleForBulkUpdate.length !== 1 ? 's' : ''}?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-text-secondary" asChild>
                      <div>
                        <span className="block mb-2">
                          This will trigger updates for the following apps:
                        </span>
                        {/* Warn about major updates */}
                        {eligibleForBulkUpdate.some(u => classifyUpdateType(u.current_version, u.latest_version) === 'major') && (
                          <span className="flex items-center gap-2 px-3 py-2 mb-2 bg-status-warning/10 border border-status-warning/20 rounded-lg text-sm text-status-warning">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            Includes major version updates -- review carefully
                          </span>
                        )}
                        <span className="block max-h-40 overflow-y-auto space-y-1">
                          {eligibleForBulkUpdate.map(u => {
                            const type = classifyUpdateType(u.current_version, u.latest_version);
                            return (
                              <span key={u.id} className="flex items-center gap-2 text-sm text-text-muted">
                                <span className={cn(
                                  'text-[10px] font-bold uppercase tracking-wide px-1 py-0.5 rounded border',
                                  type === 'major' ? 'text-status-warning bg-status-warning/10 border-status-warning/20' :
                                  type === 'minor' ? 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/20' :
                                  'text-text-muted bg-overlay/5 border-overlay/10'
                                )}>
                                  {type}
                                </span>
                                {u.display_name} ({u.current_version} &rarr; {u.latest_version})
                              </span>
                            );
                          })}
                        </span>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-overlay/10 text-text-secondary hover:bg-overlay/5">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleBulkUpdate}
                      className="bg-accent-cyan hover:bg-accent-cyan-bright text-bg-deepest font-medium"
                    >
                      Update All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        }
      />

      {/* Critical Updates Banner */}
      {criticalCount > 0 && (
        <motion.div
          variants={shouldReduceMotion ? undefined : fadeIn}
          initial={shouldReduceMotion ? { opacity: 1 } : 'hidden'}
          animate={shouldReduceMotion ? { opacity: 1 } : 'visible'}
          role="alert"
          className="glass-light rounded-xl p-4 border-l-[3px] border-l-status-warning border-t border-r border-b border-black/[0.08] bg-gradient-to-r from-status-warning/5 to-transparent"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-status-warning flex-shrink-0" />
              <p className="text-sm font-medium text-text-primary">
                {criticalCount} critical update{criticalCount !== 1 ? 's' : ''} require{criticalCount === 1 ? 's' : ''} attention
                {oldestCriticalAge && (
                  <span className="text-text-muted font-normal ml-2">
                    ({oldestCriticalAge})
                  </span>
                )}
              </p>
            </div>
            {!showCriticalOnly && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCriticalOnly(true)}
                className="text-status-warning hover:text-status-warning hover:bg-status-warning/10 text-xs font-medium flex-shrink-0"
              >
                View Critical
              </Button>
            )}
          </div>
        </motion.div>
      )}

      {/* Stats Cards */}
      <StatCardGrid columns={4}>
        <AnimatedStatCard
          title="Available Updates"
          value={availableCount}
          icon={Package}
          color="cyan"
          delay={0}
          loading={isLoadingUpdates}
        />
        <AnimatedStatCard
          title="Critical Updates"
          value={criticalCount}
          icon={AlertTriangle}
          color={criticalCount > 0 ? 'warning' : 'neutral'}
          delay={0.1}
          loading={isLoadingUpdates}
          description={oldestCriticalAge || undefined}
        />
        <AnimatedStatCard
          title="Auto-Update Enabled"
          value={autoUpdateCount}
          icon={RefreshCw}
          color="success"
          delay={0.2}
          loading={isLoadingUpdates}
          description={availableCount > 0 ? `${autoUpdateCount} of ${availableCount}` : undefined}
        />
        <AnimatedStatCard
          title="Updated (7 days)"
          value={recentAutoUpdates}
          icon={CheckCircle2}
          color="violet"
          delay={0.3}
          loading={isLoadingHistory}
          description={failedUpdates > 0 ? `${failedUpdates} failed` : undefined}
        />
      </StatCardGrid>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v: string) => setActiveTab(v as 'available' | 'history')}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <TabsList className="glass-light border border-overlay/5">
            <TabsTrigger value="available" className="data-[state=active]:bg-overlay/10">
              <Package className="w-4 h-4 mr-2" />
              Available
              {!isLoadingUpdates && availableCount > 0 && (
                <span className="ml-1.5 text-[11px] font-medium bg-overlay/[0.08] px-1.5 py-0.5 rounded-md tabular-nums">
                  {availableCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-overlay/10">
              <History className="w-4 h-4 mr-2" />
              History
              {!isLoadingHistory && history.length > 0 && (
                <span className="ml-1.5 text-[11px] font-medium bg-overlay/[0.08] px-1.5 py-0.5 rounded-md tabular-nums">
                  {history.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Available Updates Tab */}
        <TabsContent value="available" className="mt-0">
          {/* Search & Filter Toolbar */}
          {activeTab === 'available' && !mspTenantSelectionRequired && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
              {/* Search */}
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <Input
                  placeholder="Search by name or package ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-bg-elevated border-overlay/10 text-text-primary placeholder:text-text-muted"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Critical filter */}
                <Button
                  variant={showCriticalOnly ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setShowCriticalOnly(!showCriticalOnly)}
                  className={cn(
                    'h-8 text-xs',
                    showCriticalOnly
                      ? 'bg-status-warning/20 text-status-warning hover:bg-status-warning/30 border border-status-warning/20'
                      : 'text-text-secondary hover:text-text-primary'
                  )}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
                  Critical
                  {criticalCount > 0 && (
                    <span className="ml-1 tabular-nums">{criticalCount}</span>
                  )}
                </Button>

                {/* Update type filter */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={updateTypeFilter ? 'default' : 'ghost'}
                      size="sm"
                      className={cn(
                        'h-8 text-xs',
                        updateTypeFilter
                          ? 'bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30 border border-accent-cyan/20'
                          : 'text-text-secondary hover:text-text-primary'
                      )}
                    >
                      <Filter className="w-3.5 h-3.5 mr-1.5" />
                      {updateTypeFilter ? updateTypeFilter.charAt(0).toUpperCase() + updateTypeFilter.slice(1) : 'Type'}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44 bg-bg-elevated border-overlay/10 shadow-soft-lg">
                    <DropdownMenuLabel className="text-[11px] text-text-muted uppercase tracking-wide">Update Type</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-overlay/[0.06]" />
                    <DropdownMenuItem
                      onClick={() => setUpdateTypeFilter(null)}
                      className={cn('text-sm', !updateTypeFilter && 'text-accent-cyan')}
                    >
                      All types
                      {!updateTypeFilter && <CheckCircle2 className="w-3.5 h-3.5 ml-auto text-accent-cyan" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setUpdateTypeFilter('major')}
                      className={cn('text-sm', updateTypeFilter === 'major' && 'text-status-warning')}
                    >
                      Major
                      <span className="ml-auto text-[11px] text-text-muted tabular-nums">{updateTypeCounts.major}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setUpdateTypeFilter('minor')}
                      className={cn('text-sm', updateTypeFilter === 'minor' && 'text-accent-cyan')}
                    >
                      Minor
                      <span className="ml-auto text-[11px] text-text-muted tabular-nums">{updateTypeCounts.minor}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setUpdateTypeFilter('patch')}
                      className={cn('text-sm', updateTypeFilter === 'patch' && 'text-status-success')}
                    >
                      Patch
                      <span className="ml-auto text-[11px] text-text-muted tabular-nums">{updateTypeCounts.patch}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Sort */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 text-xs text-text-secondary hover:text-text-primary">
                      <ArrowUpDown className="w-3.5 h-3.5 mr-1.5" />
                      {sortLabels[sortBy]}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44 bg-bg-elevated border-overlay/10 shadow-soft-lg">
                    <DropdownMenuLabel className="text-[11px] text-text-muted uppercase tracking-wide">Sort By</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-overlay/[0.06]" />
                    {(Object.keys(sortLabels) as SortOption[]).map((option) => (
                      <DropdownMenuItem
                        key={option}
                        onClick={() => setSortBy(option)}
                        className={cn('text-sm', sortBy === option && 'text-accent-cyan')}
                      >
                        {sortLabels[option]}
                        {sortBy === option && <CheckCircle2 className="w-3.5 h-3.5 ml-auto text-accent-cyan" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Results count + clear */}
                {!isLoadingUpdates && updates.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-xs tabular-nums whitespace-nowrap',
                      hasActiveFilters ? 'text-accent-cyan font-medium' : 'text-text-muted'
                    )}>
                      {filteredUpdates.length} of {updates.length}
                    </span>
                    {hasActiveFilters && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearAllFilters}
                        className="h-6 px-1.5 text-[11px] text-text-muted hover:text-text-primary"
                      >
                        <XCircle className="w-3 h-3 mr-1" />
                        Clear
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {mspTenantSelectionRequired ? (
            <AnimatedEmptyState
              icon={Package}
              title="Select a tenant to view updates"
              description="Use the tenant switcher in the header to pick which managed tenant you want to update."
              color="neutral"
              showOrbs={false}
            />
          ) : isLoadingUpdates ? (
            <UpdateCardSkeleton count={6} />
          ) : updatesError ? (
            <AnimatedEmptyState
              icon={XCircle}
              title="Failed to load updates"
              description={updatesError.message}
              color="neutral"
              action={{
                label: 'Try Again',
                onClick: () => refetchUpdates(),
                variant: 'secondary',
              }}
            />
          ) : filteredUpdates.length > 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              {filteredUpdates.map((update, index) => (
                <UpdateCard
                  key={update.id}
                  update={update}
                  onTriggerUpdate={handleTriggerUpdate}
                  onPolicyChange={handlePolicyChange}
                  isUpdating={updatingIds.has(update.id)}
                  index={index}
                />
              ))}
            </motion.div>
          ) : updates.length > 0 ? (
            <AnimatedEmptyState
              icon={Search}
              title="No updates match your filters"
              description="Try adjusting your search or filter criteria"
              color="neutral"
              showOrbs={false}
              action={{
                label: 'Clear All Filters',
                onClick: clearAllFilters,
                variant: 'secondary',
              }}
            />
          ) : (
            <AnimatedEmptyState
              icon={CheckCircle2}
              title="All apps are up to date"
              description="No updates are currently available for your deployed apps"
              color="cyan"
            />
          )}
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="mt-0">
          {mspTenantSelectionRequired ? (
            <AnimatedEmptyState
              icon={History}
              title="Select a tenant to view update history"
              description="Auto-update history is shown per tenant to avoid mixing deployment timelines."
              color="neutral"
              showOrbs={false}
            />
          ) : (
            <AutoUpdateHistory
              history={history}
              isLoading={isLoadingHistory}
              onLoadMore={fetchMoreHistory}
              hasMore={hasMoreHistory}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function isWithinDays(dateString: string | null, days: number): boolean {
  if (!dateString) return false;
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}
