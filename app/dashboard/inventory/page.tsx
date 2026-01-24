'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { Loader2, AlertCircle, RefreshCw, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInventoryApps } from '@/hooks/use-inventory';
import { InventoryAppCard, InventoryAppDetails, InventoryFilters } from '@/components/inventory';
import { PageHeader, AnimatedEmptyState, SkeletonGrid } from '@/components/dashboard';
import type { IntuneWin32App } from '@/types/inventory';

type SortBy = 'name' | 'publisher' | 'created' | 'modified';
type SortOrder = 'asc' | 'desc';

export default function InventoryPage() {
  const router = useRouter();
  const { data, isLoading, error, refetch, isFetching } = useInventoryApps();
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const prefersReducedMotion = useReducedMotion();

  const apps = data?.apps || [];

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
  }, [apps, search, sortBy, sortOrder]);

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
        staggerChildren: 0.05,
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
          title="Inventory"
          description="Win32 applications deployed in your Intune tenant"
        />
        <SkeletonGrid count={6} columns={3} variant="content" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Inventory"
          description="Win32 applications deployed in your Intune tenant"
        />
        <AnimatedEmptyState
          icon={AlertCircle}
          title="Failed to load inventory"
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
        title="Inventory"
        description="Win32 applications deployed in your Intune tenant"
        gradient
        gradientColors="mixed"
        actions={
          <Button
            variant="ghost"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-zinc-400 hover:text-white"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

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
        />
      </motion.div>

      {/* Apps Grid */}
      {filteredApps.length > 0 ? (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        >
          {filteredApps.map((app) => (
            <motion.div key={app.id} variants={itemVariants}>
              <InventoryAppCard
                app={app}
                onClick={() => setSelectedAppId(app.id)}
                isSelected={selectedAppId === app.id}
              />
            </motion.div>
          ))}
        </motion.div>
      ) : apps.length > 0 ? (
        <AnimatedEmptyState
          icon={Package}
          title="No apps match your search"
          description="Try adjusting your search criteria"
          color="neutral"
          showOrbs={false}
          action={{
            label: 'Clear Search',
            onClick: () => setSearch(''),
            variant: 'secondary'
          }}
        />
      ) : (
        <AnimatedEmptyState
          icon={Package}
          title="No Win32 apps found"
          description="Deploy your first app from the App Catalog"
          color="cyan"
          action={{
            label: 'Browse App Catalog',
            onClick: () => router.push('/dashboard/apps'),
          }}
        />
      )}

      {/* App Details Panel */}
      {selectedAppId && (
        <InventoryAppDetails
          appId={selectedAppId}
          onClose={() => setSelectedAppId(null)}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
