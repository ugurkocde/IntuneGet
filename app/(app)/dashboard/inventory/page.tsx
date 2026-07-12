'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { T } from 'gt-next';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, RefreshCw, Package, Server, Building2, Clock, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInventoryApps } from '@/hooks/use-inventory';
import {
  InventoryAppCard,
  InventoryAppDetails,
  InventoryFilters,
  InventoryListRow,
  InventoryPagination,
  InventoryListHeader,
} from '@/components/inventory';
import { PageHeader, AnimatedEmptyState, SkeletonGrid, AnimatedStatCard, StatCardGrid } from '@/components/dashboard';
import { useUserSettings } from '@/components/providers/UserSettingsProvider';
import { usePagination } from '@/hooks/use-pagination';

type SortBy = 'name' | 'publisher' | 'created' | 'modified';
type SortOrder = 'asc' | 'desc';

export default function InventoryPage() {
  const router = useRouter();
  const { data, isLoading, error, refetch, isFetching } = useInventoryApps();
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [selectedPublisher, setSelectedPublisher] = useState<string | null>(null);
  const { settings: userSettings, setViewMode: persistViewMode } = useUserSettings();
  const [viewMode, setViewModeLocal] = useState<'grid' | 'list'>(userSettings.viewMode);
  const setViewMode = useCallback((mode: 'grid' | 'list') => {
    setViewModeLocal(mode);
    void persistViewMode(mode);
  }, [persistViewMode]);
  const prefersReducedMotion = useReducedMotion();

  const apps = data?.apps || [];

  // Compute stats
  const stats = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const publishers = new Set(apps.map((app) => app.publisher).filter(Boolean));
    const recentlyModified = apps.filter(
      (app) => new Date(app.lastModifiedDateTime) >= thirtyDaysAgo
    );
    const systemInstall = apps.filter(
      (app) => app.installExperience?.runAsAccount === 'system'
    );

    return {
      total: apps.length,
      publishers: publishers.size,
      recentlyModified: recentlyModified.length,
      systemInstall: systemInstall.length,
    };
  }, [apps]);

  // Compute sorted unique publisher list for the filter dropdown
  const publishersList = useMemo(() => {
    const publishers = apps
      .map((app) => app.publisher)
      .filter((p): p is string => !!p);
    return [...new Set(publishers)].sort((a, b) => a.localeCompare(b));
  }, [apps]);

  // Filter and sort apps
  const filteredApps = useMemo(() => {
    let filtered = apps;

    // Filter by search
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (app) =>
          app.displayName.toLowerCase().includes(searchLower) ||
          app.publisher?.toLowerCase().includes(searchLower) ||
          app.description?.toLowerCase().includes(searchLower)
      );
    }

    // Filter by publisher
    if (selectedPublisher) {
      filtered = filtered.filter((app) => app.publisher === selectedPublisher);
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.displayName.localeCompare(b.displayName);
          break;
        case 'publisher':
          comparison = (a.publisher || '').localeCompare(b.publisher || '');
          break;
        case 'created':
          comparison = new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime();
          break;
        case 'modified':
          comparison = new Date(a.lastModifiedDateTime).getTime() - new Date(b.lastModifiedDateTime).getTime();
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [apps, search, sortBy, sortOrder, selectedPublisher]);

  // Pagination
  const {
    pageItems,
    page,
    totalPages,
    nextPage,
    prevPage,
    canGoNext,
    canGoPrev,
    startIndex,
    endIndex,
    setPage,
  } = usePagination(filteredApps, { pageSize: 24 });

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, sortBy, sortOrder, selectedPublisher, setPage]);

  const handleSortChange = (newSortBy: SortBy) => {
    if (newSortBy === sortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('asc');
    }
  };

  const handleUpdate = (appName: string) => {
    // Navigate to App Catalog with search pre-filled
    router.push(`/dashboard/apps?search=${encodeURIComponent(appName)}`);
    setSelectedAppId(null);
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: prefersReducedMotion ? {} : {
        staggerChildren: 0.03,
        delayChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion ? { duration: 0.2 } : {
        duration: 0.4,
        ease: [0.25, 0.46, 0.45, 0.94] as const
      }
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<T>Inventory</T>}
          description={<T>Win32 applications deployed in your Intune tenant</T>}
        />
        <SkeletonGrid count={4} columns={4} variant="stat" />
        <SkeletonGrid count={6} columns={3} variant="content" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<T>Inventory</T>}
          description={<T>Win32 applications deployed in your Intune tenant</T>}
        />
        <AnimatedEmptyState
          icon={AlertCircle}
          title={<T>Failed to load inventory</T>}
          description={error.message}
          color="neutral"
          action={{
            label: 'Try Again',
            onClick: () => refetch(),
            variant: 'secondary'
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={<T>Inventory</T>}
        description={<T>Win32 applications deployed in your Intune tenant</T>}
        gradient
        gradientColors="mixed"
        actions={
          <Button
            variant="ghost"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-text-secondary hover:text-text-primary"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            <T>Refresh</T>
          </Button>
        }
      />

      {/* Stats Row */}
      {apps.length > 0 && (
        <StatCardGrid columns={4}>
          <AnimatedStatCard
            title={<T>Total Apps</T>}
            value={stats.total}
            icon={Server}
            color="cyan"
            delay={0}
          />
          <AnimatedStatCard
            title={<T>Publishers</T>}
            value={stats.publishers}
            icon={Building2}
            color="neutral"
            delay={0.1}
          />
          <AnimatedStatCard
            title={<T>Recently Modified</T>}
            value={stats.recentlyModified}
            icon={Clock}
            color="violet"
            delay={0.2}
            description={<T>Last 30 days</T>}
          />
          <AnimatedStatCard
            title={<T>System Install</T>}
            value={stats.systemInstall}
            icon={Shield}
            color="neutral"
            delay={0.3}
          />
        </StatCardGrid>
      )}

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <InventoryFilters
          search={search}
          onSearchChange={setSearch}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChange={handleSortChange}
          onSortOrderToggle={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          totalCount={apps.length}
          filteredCount={filteredApps.length}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          publishers={publishersList}
          selectedPublisher={selectedPublisher}
          onPublisherChange={setSelectedPublisher}
        />
      </motion.div>

      {/* Apps Grid / List */}
      {filteredApps.length > 0 ? (
        <>
          {viewMode === 'grid' ? (
            <motion.div
              key={page}
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
            >
              {pageItems.map((app) => (
                <motion.div key={app.id} variants={itemVariants}>
                  <InventoryAppCard
                    app={app}
                    onClick={() => setSelectedAppId(app.id)}
                    isSelected={selectedAppId === app.id}
                  />
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <>
              <InventoryListHeader />
              <motion.div
                key={page}
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-2"
              >
                {pageItems.map((app) => (
                  <motion.div key={app.id} variants={itemVariants}>
                    <InventoryListRow
                      app={app}
                      onClick={() => setSelectedAppId(app.id)}
                      isSelected={selectedAppId === app.id}
                    />
                  </motion.div>
                ))}
              </motion.div>
            </>
          )}
          <InventoryPagination
            page={page}
            totalPages={totalPages}
            startIndex={startIndex}
            endIndex={endIndex}
            totalItems={filteredApps.length}
            canGoNext={canGoNext}
            canGoPrev={canGoPrev}
            onNextPage={nextPage}
            onPrevPage={prevPage}
          />
        </>
      ) : apps.length > 0 ? (
        <AnimatedEmptyState
          icon={Package}
          title={<T>No apps match your search</T>}
          description={<T>Try adjusting your search criteria</T>}
          color="neutral"
          showOrbs={false}
          action={{
            label: 'Clear Search',
            onClick: () => {
              setSearch('');
              setSelectedPublisher(null);
            },
            variant: 'secondary'
          }}
        />
      ) : (
        <AnimatedEmptyState
          icon={Package}
          title={<T>No Win32 apps found</T>}
          description={<T>Deploy your first app from the App Catalog</T>}
          color="cyan"
          action={{
            label: 'Browse App Catalog',
            onClick: () => router.push('/dashboard/apps'),
          }}
        />
      )}

      {/* App Details Panel */}
      <InventoryAppDetails
        appId={selectedAppId}
        onClose={() => setSelectedAppId(null)}
        onUpdate={handleUpdate}
      />
    </div>
  );
}
