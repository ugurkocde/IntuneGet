'use client';

import { useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Package,
  History,
  Settings,
  Filter,
  Search,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, AnimatedStatCard, StatCardGrid, AnimatedEmptyState } from '@/components/dashboard';
import { UpdateCard, UpdateCardSkeleton, AutoUpdateHistory } from '@/components/updates';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAvailableUpdates, useAutoUpdateHistory, useTriggerUpdate, useUpdatePolicy } from '@/hooks/use-updates';
import { cn } from '@/lib/utils';
import type { AvailableUpdate, UpdatePolicyType, AutoUpdateHistoryWithPolicy } from '@/types/update-policies';

export default function UpdatesPage() {
  const [search, setSearch] = useState('');
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<'available' | 'history'>('available');
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const prefersReducedMotion = useReducedMotion();

  // Data hooks
  const {
    data: updatesData,
    isLoading: isLoadingUpdates,
    error: updatesError,
    refetch: refetchUpdates,
    isFetching: isFetchingUpdates,
  } = useAvailableUpdates({ criticalOnly: showCriticalOnly });

  const {
    data: historyData,
    isLoading: isLoadingHistory,
    fetchMore: fetchMoreHistory,
    hasMore: hasMoreHistory,
  } = useAutoUpdateHistory();

  const { triggerUpdate } = useTriggerUpdate();
  const { updatePolicy } = useUpdatePolicy();

  const updates = updatesData?.updates || [];
  const history = historyData?.history || [];

  // Filter updates by search
  const filteredUpdates = updates.filter((update) => {
    if (!search.trim()) return true;
    const searchLower = search.toLowerCase();
    return (
      update.display_name.toLowerCase().includes(searchLower) ||
      update.winget_id.toLowerCase().includes(searchLower)
    );
  });

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

  // Handlers
  const handleTriggerUpdate = useCallback(async (update: AvailableUpdate) => {
    setUpdatingIds((prev) => new Set(prev).add(update.id));
    try {
      await triggerUpdate({
        winget_id: update.winget_id,
        tenant_id: update.tenant_id,
      });
      // Refetch to update the list
      refetchUpdates();
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(update.id);
        return next;
      });
    }
  }, [triggerUpdate, refetchUpdates]);

  const handlePolicyChange = useCallback(async (
    update: AvailableUpdate,
    policyType: UpdatePolicyType
  ) => {
    await updatePolicy({
      winget_id: update.winget_id,
      tenant_id: update.tenant_id,
      policy_type: policyType,
    });
    refetchUpdates();
  }, [updatePolicy, refetchUpdates]);

  const handleBulkUpdate = useCallback(async () => {
    // Trigger updates for all non-ignored apps
    const eligibleUpdates = filteredUpdates.filter(
      (u) => u.policy?.policy_type !== 'ignore' && u.policy?.policy_type !== 'pin_version'
    );

    for (const update of eligibleUpdates) {
      await handleTriggerUpdate(update);
    }
  }, [filteredUpdates, handleTriggerUpdate]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Updates"
        description="Manage app updates and auto-update policies"
        gradient
        gradientColors="cyan"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => refetchUpdates()}
              disabled={isFetchingUpdates}
              className="text-text-secondary hover:text-text-primary"
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', isFetchingUpdates && 'animate-spin')} />
              Refresh
            </Button>
            {filteredUpdates.length > 0 && (
              <Button
                onClick={handleBulkUpdate}
                className="bg-accent-cyan hover:bg-accent-cyan-bright text-bg-deepest font-medium"
              >
                Update All ({filteredUpdates.length})
              </Button>
            )}
          </div>
        }
      />

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
        />
        <AnimatedStatCard
          title="Auto-Update Enabled"
          value={autoUpdateCount}
          icon={RefreshCw}
          color="success"
          delay={0.2}
          loading={isLoadingUpdates}
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
          <TabsList className="glass-light border border-black/5">
            <TabsTrigger value="available" className="data-[state=active]:bg-black/10">
              <Package className="w-4 h-4 mr-2" />
              Available Updates
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-black/10">
              <History className="w-4 h-4 mr-2" />
              Update History
            </TabsTrigger>
          </TabsList>

          {activeTab === 'available' && (
            <div className="flex items-center gap-3 w-full sm:w-auto">
              {/* Search */}
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <Input
                  placeholder="Search updates..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-bg-elevated border-black/10 text-text-primary placeholder:text-text-muted"
                />
              </div>

              {/* Critical Filter */}
              <Button
                variant={showCriticalOnly ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setShowCriticalOnly(!showCriticalOnly)}
                className={cn(
                  showCriticalOnly
                    ? 'bg-status-warning/20 text-status-warning hover:bg-status-warning/30'
                    : 'text-text-secondary hover:text-text-primary'
                )}
              >
                <AlertTriangle className="w-4 h-4 mr-1.5" />
                Critical
              </Button>
            </div>
          )}
        </div>

        {/* Available Updates Tab */}
        <TabsContent value="available" className="mt-0">
          {isLoadingUpdates ? (
            <UpdateCardSkeleton count={5} />
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
              className="space-y-4"
            >
              {filteredUpdates.map((update) => (
                <UpdateCard
                  key={update.id}
                  update={update}
                  onTriggerUpdate={handleTriggerUpdate}
                  onPolicyChange={handlePolicyChange}
                  isUpdating={updatingIds.has(update.id)}
                />
              ))}
            </motion.div>
          ) : updates.length > 0 ? (
            <AnimatedEmptyState
              icon={Search}
              title="No updates match your search"
              description="Try adjusting your search criteria"
              color="neutral"
              showOrbs={false}
              action={{
                label: 'Clear Search',
                onClick: () => setSearch(''),
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
          <AutoUpdateHistory
            history={history}
            isLoading={isLoadingHistory}
            onLoadMore={fetchMoreHistory}
            hasMore={hasMoreHistory}
          />
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
