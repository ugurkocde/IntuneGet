'use client';

import { useState } from 'react';
import { T } from 'gt-next';
import { motion, useReducedMotion } from 'framer-motion';
import { Download, Loader2, RefreshCw, TrendingUp, Package, AlertTriangle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAnalytics, useExportAnalytics } from '@/hooks/useAnalytics';
import {
  SuccessRateChart,
  DeploymentsLineChart,
  TopAppsChart,
  RecentFailuresTable,
  DateRangePicker,
} from '@/components/reports';
import { PageHeader, AnimatedStatCard, StatCardGrid, SkeletonGrid, AnimatedEmptyState } from '@/components/dashboard';

export default function ReportsPage() {
  const [days, setDays] = useState(30);
  const [isExporting, setIsExporting] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useAnalytics(days);
  const { exportCSV } = useExportAnalytics();
  const prefersReducedMotion = useReducedMotion();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportCSV(days);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: prefersReducedMotion ? {} : {
        staggerChildren: 0.1,
        delayChildren: 0.2
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion ? { duration: 0.2 } : {
        duration: 0.5,
        ease: [0.25, 0.46, 0.45, 0.94] as const
      }
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<T>Reports & Analytics</T>}
          description={<T>Track your deployment performance and trends</T>}
        />
        <SkeletonGrid count={4} columns={4} variant="stat" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="glass-light rounded-xl p-6 border border-overlay/5 h-64 animate-pulse" />
          <div className="glass-light rounded-xl p-6 border border-overlay/5 h-64 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<T>Reports & Analytics</T>}
          description={<T>Track your deployment performance and trends</T>}
        />
        <AnimatedEmptyState
          icon={AlertTriangle}
          title="Failed to load analytics"
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

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={<T>Reports & Analytics</T>}
        description={<T>Track your deployment performance and trends</T>}
        gradient
        gradientColors="mixed"
        actions={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-text-secondary hover:text-text-primary"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              <T>Refresh</T>
            </Button>
            <Button
              onClick={handleExport}
              disabled={isExporting}
              className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-bg-elevated"
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              <T>Export CSV</T>
            </Button>
          </div>
        }
      />

      {/* Date Range Picker */}
      <motion.div
        variants={itemVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0"
      >
        <DateRangePicker value={days} onChange={setDays} />
        <p className="text-sm text-text-muted">
          {data?.dateRange && (
            <>
              {new Date(data.dateRange.start).toLocaleDateString()} -{' '}
              {new Date(data.dateRange.end).toLocaleDateString()}
            </>
          )}
        </p>
      </motion.div>

      {/* Summary Stats */}
      <StatCardGrid columns={4}>
        <AnimatedStatCard
          title={<T>Total Deployments</T>}
          value={summary?.totalJobs || 0}
          icon={Package}
          color="cyan"
          delay={0}
        />
        <AnimatedStatCard
          title={<T>Successful</T>}
          value={summary?.completedJobs || 0}
          icon={TrendingUp}
          color="success"
          delay={0.1}
        />
        <AnimatedStatCard
          title={<T>Failed</T>}
          value={summary?.failedJobs || 0}
          icon={AlertTriangle}
          color="error"
          delay={0.2}
        />
        <AnimatedStatCard
          title={<T>Pending</T>}
          value={summary?.pendingJobs || 0}
          icon={Clock}
          color="warning"
          delay={0.3}
        />
      </StatCardGrid>

      {/* Charts Grid */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid gap-6 lg:grid-cols-2"
      >
        {/* Success Rate */}
        <motion.div
          variants={itemVariants}
          className="glass-light border border-overlay/5 rounded-xl p-6 hover:border-accent-cyan/20 transition-colors"
        >
          <h2 className="text-lg font-semibold text-text-primary mb-4"><T>Success Rate</T></h2>
          <SuccessRateChart
            completed={summary?.completedJobs || 0}
            failed={summary?.failedJobs || 0}
            pending={summary?.pendingJobs || 0}
          />
        </motion.div>

        {/* Deployments Over Time */}
        <motion.div
          variants={itemVariants}
          className="glass-light border border-overlay/5 rounded-xl p-6 hover:border-accent-cyan/20 transition-colors"
        >
          <h2 className="text-lg font-semibold text-text-primary mb-4">
            <T>Deployments Over Time</T>
          </h2>
          <DeploymentsLineChart data={data?.dailyDeployments || []} />
        </motion.div>
      </motion.div>

      {/* Top Apps */}
      <motion.div
        variants={itemVariants}
        initial="hidden"
        animate="visible"
        className="glass-light border border-overlay/5 rounded-xl p-6 hover:border-accent-cyan/20 transition-colors"
      >
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          <T>Most Deployed Applications</T>
        </h2>
        <TopAppsChart data={data?.topApps || []} />
      </motion.div>

      {/* Recent Failures */}
      <motion.div
        variants={itemVariants}
        initial="hidden"
        animate="visible"
        className="glass-light border border-overlay/5 rounded-xl p-6 hover:border-accent-cyan/20 transition-colors"
      >
        <h2 className="text-lg font-semibold text-text-primary mb-4"><T>Recent Failures</T></h2>
        <RecentFailuresTable data={data?.recentFailures || []} />
      </motion.div>
    </div>
  );
}
