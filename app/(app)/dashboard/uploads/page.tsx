'use client';

import { useState, useEffect, useCallback } from 'react';
import { T, Var } from "gt-next";
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Upload,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ExternalLink,
  RefreshCw,
  Loader2,
  ChevronRight,
  Play,
  Ban,
  Users,
  Monitor,
  UserCircle,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';
import { ProgressStepper } from '@/components/ProgressStepper';
import { ErrorDisplay } from '@/components/ErrorDisplay';
import { EspProfileSelector } from '@/components/EspProfileSelector';
import { PageHeader, AnimatedStatCard, StatCardGrid, AnimatedEmptyState, SkeletonCard, SkeletonGrid } from '@/components/dashboard';
import type { PackageAssignment } from '@/types/upload';

interface PackagingJob {
  id: string;
  user_id: string;
  user_email?: string | null;
  winget_id: string;
  version: string;
  display_name: string;
  publisher: string;
  architecture: string;
  installer_type: string;
  app_source?: 'win32' | 'store';
  status: 'queued' | 'packaging' | 'completed' | 'failed' | 'uploading' | 'deployed' | 'cancelled' | 'duplicate_skipped';
  status_message?: string;
  progress_percent: number;
  error_message?: string;
  error_stage?: string;
  error_category?: string;
  error_code?: string;
  error_details?: Record<string, unknown>;
  warnings?: string[];
  github_run_id?: number;
  github_run_url?: string;
  intunewin_url?: string;
  intune_app_id?: string;
  intune_app_url?: string;
  created_at: string;
  updated_at: string;
  packaging_started_at?: string;
  packaging_completed_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  cancelled_by?: string;
  package_config?: {
    assignments?: PackageAssignment[];
  };
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function UploadsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, getAccessToken, signIn } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  const prefersReducedMotion = useReducedMotion();

  const [jobs, setJobs] = useState<PackagingJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [redeployingJobId, setRedeployingJobId] = useState<string | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Get job IDs and status filter from URL params
  const highlightedJobIds = searchParams.get('jobs')?.split(',') || [];
  const urlStatus = searchParams.get('status');
  const initialFilter = (['all', 'active', 'completed', 'failed', 'pending'] as const).includes(
    urlStatus as 'all' | 'active' | 'completed' | 'failed' | 'pending'
  )
    ? (urlStatus === 'pending' ? 'active' : urlStatus as 'all' | 'active' | 'completed' | 'failed')
    : 'all';
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>(initialFilter);
  // 'mine' shows the signed-in user's deployments; 'tenant' shows everyone's in
  // the tenant so a team can avoid deploying the same app twice.
  const [viewScope, setViewScope] = useState<'mine' | 'tenant'>('mine');

  const fetchJobs = useCallback(async (showRefreshing = false) => {
    if (!user?.id) return;

    if (showRefreshing) {
      setIsRefreshing(true);
    }

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        // Silent refresh failed and interactive auth is required; stop polling
        // and prompt for re-auth instead of sending an unauthenticated request.
        setSessionExpired(true);
        return;
      }
      const url = viewScope === 'tenant' ? '/api/package?scope=tenant' : '/api/package';
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          // Scope to the MSP-selected customer tenant when one is active, so the
          // tenant view matches the rest of the app (and customer-only members
          // are not resolved to the primary tenant and rejected).
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (response.status === 401) {
        setSessionExpired(true);
        return;
      }

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to fetch jobs');
        }
        throw new Error(`Failed to fetch jobs (${response.status})`);
      }

      const data = await response.json();
      setJobs(data.jobs || []);
      setError(null);
      setSessionExpired(false);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user?.id, getAccessToken, viewScope, isMspUser, selectedTenantId]);

  // Initial load
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Auto-refresh active jobs without hammering the API. Browsers in the
  // background poll less often and a manual refresh remains available.
  useEffect(() => {
    const hasActiveJobs = jobs.some((job) =>
      ['queued', 'packaging', 'uploading'].includes(job.status)
    );

    if (!hasActiveJobs || sessionExpired) return;

    const interval = setInterval(() => {
      fetchJobs();
    }, document.visibilityState === 'visible' ? 5000 : 15000);

    return () => clearInterval(interval);
  }, [jobs, fetchJobs, sessionExpired]);

  const handleSignInAgain = async () => {
    try {
      await signIn();
      setSessionExpired(false);
      fetchJobs(true);
    } catch (err) {
      console.error('Re-authentication failed:', err);
    }
  };

  const handleRefresh = () => {
    fetchJobs(true);
  };

  const handleCancelJob = async (jobId: string, dismiss?: boolean) => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    // Optimistic UI update: immediately update state so the dialog closes fast
    const previousJobs = jobs;
    if (dismiss) {
      // For dismiss, remove the job from the list immediately
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } else {
      // For cancel, mark as cancelled immediately
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, status: 'cancelled' as const, cancelled_at: new Date().toISOString() }
            : j
        )
      );
    }

    // Fire the API call in the background
    try {
      const response = await fetch('/api/package/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ jobId, dismiss }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to cancel job');
        }
        throw new Error(`Failed to cancel job (${response.status})`);
      }

      // Silently sync with server to pick up any fields set by the backend
      fetchJobs();
    } catch (err) {
      // Revert optimistic update on failure
      setJobs(previousJobs);
      console.error('Failed to cancel job:', err);
      setError(err instanceof Error ? err.message : `Failed to ${dismiss ? 'dismiss' : 'cancel'} job`);
    }
  };

  const handleClearHistory = async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setIsClearingHistory(true);
    try {
      const response = await fetch('/api/package/clear-history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to clear history');
        }
        throw new Error(`Failed to clear history (${response.status})`);
      }

      await fetchJobs();
    } catch (err) {
      console.error('Failed to clear history:', err);
      setError(err instanceof Error ? err.message : 'Failed to clear history');
    } finally {
      setIsClearingHistory(false);
    }
  };

  const handleRedeploy = async (job: PackagingJob, forceCreate = false) => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    if (!job.package_config) {
      setError('The original package configuration is unavailable. Create a new deployment from the catalog.');
      return;
    }

    setRedeployingJobId(job.id);
    try {
      const response = await fetch('/api/package', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          items: [job.package_config],
          forceCreate,
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to redeploy');
        }
        throw new Error(`Failed to redeploy (${response.status})`);
      }

      // Refresh jobs to show the new job
      await fetchJobs();
      setFilter('active');
    } catch (err) {
      console.error('Failed to redeploy:', err);
      setError(err instanceof Error ? err.message : 'Failed to redeploy');
    } finally {
      setRedeployingJobId(null);
    }
  };

  const filteredJobs = jobs.filter((job) => {
    switch (filter) {
      case 'active':
        return ['queued', 'packaging', 'uploading'].includes(job.status);
      case 'completed':
        return ['completed', 'deployed', 'duplicate_skipped'].includes(job.status);
      case 'failed':
        return ['failed', 'cancelled'].includes(job.status);
      default:
        return true;
    }
  });

  const stats = {
    total: jobs.length,
    active: jobs.filter((j) =>
      ['queued', 'packaging', 'uploading'].includes(j.status)
    ).length,
    completed: jobs.filter((j) => ['completed', 'deployed', 'duplicate_skipped'].includes(j.status)).length,
    failed: jobs.filter((j) => j.status === 'failed').length,
  };

  const filterButtons = ['all', 'active', 'completed', 'failed'] as const;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<T>Uploads</T>}
          description={<T>Monitor your package deployments to Intune</T>}
        />
        <SkeletonGrid count={4} columns={4} variant="stat" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <SkeletonCard key={i} variant="list-item" showIcon className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Uploads"
        description="Monitor your package deployments to Intune"
        gradient
        gradientColors="mixed"
        badge={stats.active > 0 ? { text: <T>Live</T>, variant: 'success' as const } : undefined}
        actions={
          <div className="flex items-center gap-2">
            {(stats.completed + stats.failed) > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={isClearingHistory}
                    className="border-status-error/20 text-status-error hover:bg-status-error/10 hover:border-status-error/40"
                  >
                    {isClearingHistory ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    <T>Clear History</T>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle><T>Clear Upload History?</T></AlertDialogTitle>
                    <AlertDialogDescription>
                      <T>This hides completed, failed, cancelled, and deployed jobs from this page. Deployment audit and update records are preserved. Active jobs are not affected.</T>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel><T>Keep History</T></AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearHistory}>
                      <T>Clear All</T>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button
              onClick={handleRefresh}
              disabled={isRefreshing}
              variant="outline"
              className="border-overlay/10 text-text-secondary hover:bg-overlay/5 hover:border-black/20"
            >
              {isRefreshing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              <T>Refresh</T>
            </Button>
          </div>
        }
      />

      {/* Session expired banner */}
      <AnimatePresence>
        {sessionExpired && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-start gap-3 p-4 bg-status-warning/10 border border-status-warning/20 rounded-lg"
          >
            <AlertTriangle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-status-warning font-medium"><T>Your session has expired</T></p>
              <p className="text-text-secondary text-sm mt-1">
                <T>Job statuses are no longer updating. Sign in again to resume live updates.</T>
              </p>
            </div>
            <Button
              onClick={handleSignInAgain}
              variant="outline"
              className="border-status-warning/30 text-status-warning hover:bg-status-warning/10 flex-shrink-0"
            >
              <T>Sign In Again</T>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error message */}
      <AnimatePresence>
        {error && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-start gap-3 p-4 bg-status-error/10 border border-status-error/20 rounded-lg"
          >
            <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-status-error font-medium"><T>Error loading jobs</T></p>
              <p className="text-status-error/70 text-sm mt-1">{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <StatCardGrid columns={4}>
        <AnimatedStatCard
          title={<T>Total</T>}
          value={stats.total}
          icon={Package}
          color="cyan"
          delay={0}
          onClick={() => setFilter('all')}
          isActive={filter === 'all'}
        />
        <AnimatedStatCard
          title={<T>Active</T>}
          value={stats.active}
          icon={Clock}
          color="violet"
          delay={0.1}
          onClick={() => setFilter('active')}
          isActive={filter === 'active'}
        />
        <AnimatedStatCard
          title={<T>Completed</T>}
          value={stats.completed}
          icon={CheckCircle2}
          color="success"
          delay={0.2}
          onClick={() => setFilter('completed')}
          isActive={filter === 'completed'}
        />
        <AnimatedStatCard
          title={<T>Failed</T>}
          value={stats.failed}
          icon={XCircle}
          color="error"
          delay={0.3}
          onClick={() => setFilter('failed')}
          isActive={filter === 'failed'}
        />
      </StatCardGrid>

      {/* Scope toggle: my deployments vs everyone in the tenant */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="flex items-center gap-2"
        role="tablist"
        aria-label="Choose whose deployments to show"
      >
        {(['mine', 'tenant'] as const).map((scope) => (
          <button
            key={scope}
            role="tab"
            aria-selected={viewScope === scope}
            onClick={() => setViewScope(scope)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-[background-color,color,border-color] duration-200 focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:outline-none',
              viewScope === scope
                ? 'bg-overlay/10 text-text-primary border border-accent-cyan/30'
                : 'bg-overlay/5 text-text-secondary hover:text-text-primary hover:bg-overlay/10 border border-overlay/5'
            )}
          >
            {scope === 'mine' ? <T>My deployments</T> : <T>All in tenant</T>}
          </button>
        ))}
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Filter uploads by status"
      >
        {filterButtons.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            tabIndex={filter === f ? 0 : -1}
            onClick={() => setFilter(f)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-[background-color,color,border-color] duration-200 focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:outline-none',
              filter === f
                ? 'bg-gradient-to-r from-accent-cyan to-accent-violet text-bg-elevated'
                : 'bg-overlay/5 text-text-secondary hover:text-text-primary hover:bg-overlay/10 border border-overlay/5'
            )}
          >
            <T>{f.charAt(0).toUpperCase() + f.slice(1)}</T>
          </button>
        ))}
      </motion.div>

      {/* Jobs list */}
      {filteredJobs.length === 0 ? (
        <AnimatedEmptyState
          icon={Upload}
          title={filter === 'all' ? <T>No uploads yet</T> : <T>No {filter} uploads</T>}
          description={
            filter === 'all'
              ? <T>Add packages from the App Catalog to get started</T>
              : <T>You have no {filter} uploads to display</T>
          }
          color="cyan"
          showOrbs={filter === 'all'}
          action={
            filter === 'all'
              ? {
                  label: <T>Browse App Catalog</T>,
                  onClick: () => router.push('/dashboard/apps'),
                }
              : undefined
          }
        />
      ) : (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: {
                staggerChildren: prefersReducedMotion ? 0 : 0.05
              }
            }
          }}
          className="space-y-4"
        >
          <AnimatePresence mode="popLayout">
            {filteredJobs.map((job, index) => (
              <UploadJobCard
                key={job.id}
                job={job}
                index={index}
                isHighlighted={highlightedJobIds.includes(job.id)}
                onCancel={handleCancelJob}
                isCancelling={cancellingJobId === job.id}
                onRedeploy={handleRedeploy}
                isRedeploying={redeployingJobId === job.id}
                showOwner={viewScope === 'tenant'}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

function UploadJobCard({
  job,
  index,
  isHighlighted,
  onCancel,
  isCancelling,
  onRedeploy,
  isRedeploying,
  showOwner,
}: {
  job: PackagingJob;
  index: number;
  isHighlighted?: boolean;
  onCancel: (jobId: string, dismiss?: boolean) => void;
  isCancelling?: boolean;
  onRedeploy: (job: PackagingJob, forceCreate?: boolean) => void;
  isRedeploying?: boolean;
  showOwner?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();

  const statusConfig = {
    queued: {
      icon: Clock,
      label: 'Queued',
      color: 'text-text-secondary',
      bg: 'bg-overlay/5',
      border: 'border-l-overlay/20',
    },
    packaging: {
      icon: Package,
      label: 'Packaging',
      color: 'text-accent-cyan',
      bg: 'bg-accent-cyan/10',
      border: 'border-l-accent-cyan',
    },
    uploading: {
      icon: Upload,
      label: 'Uploading',
      color: 'text-accent-violet',
      bg: 'bg-accent-violet/10',
      border: 'border-l-accent-violet',
    },
    completed: {
      icon: CheckCircle2,
      label: 'Packaged',
      color: 'text-status-success',
      bg: 'bg-status-success/10',
      border: 'border-l-status-success',
    },
    deployed: {
      icon: CheckCircle2,
      label: 'Deployed',
      color: 'text-status-success',
      bg: 'bg-status-success/10',
      border: 'border-l-status-success',
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      color: 'text-status-error',
      bg: 'bg-status-error/10',
      border: 'border-l-status-error',
    },
    cancelled: {
      icon: Ban,
      label: 'Cancelled',
      color: 'text-status-warning',
      bg: 'bg-status-warning/10',
      border: 'border-l-status-warning',
    },
    duplicate_skipped: {
      icon: AlertCircle,
      label: 'Duplicate Found',
      color: 'text-status-warning',
      bg: 'bg-status-warning/10',
      border: 'border-l-status-warning',
    },
  };

  const config = statusConfig[job.status] || statusConfig.queued;
  const StatusIcon = config.icon;
  const isActive = ['queued', 'packaging', 'uploading'].includes(job.status);
  const isStale = isActive && (Date.now() - new Date(job.updated_at).getTime()) > 75 * 60 * 1000;
  // Allow cancelling active jobs or dismissing completed/failed jobs
  const isCancellable = ['queued', 'packaging', 'uploading'].includes(job.status);
  const isDismissable = ['completed', 'failed', 'duplicate_skipped', 'deployed'].includes(job.status);
  const canRemove = isCancellable || isDismissable;

  const itemVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion ? { duration: 0.15 } : {
        duration: 0.4,
        ease: [0.25, 0.46, 0.45, 0.94] as const
      }
    },
    exit: {
      opacity: 0,
      scale: prefersReducedMotion ? 1 : 0.95,
      transition: { duration: prefersReducedMotion ? 0.1 : 0.2 }
    }
  };

  return (
    <motion.div
      layout
      variants={itemVariants}
      className={cn(
        'glass-light border border-l-[3px] rounded-xl p-6 transition-[border-color,box-shadow,background-color] contain-layout',
        config.border,
        isHighlighted
          ? 'border-accent-cyan/50 border-l-accent-cyan ring-1 ring-accent-cyan/20 shadow-glow-cyan'
          : 'border-overlay/5 hover:border-overlay/10'
      )}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className={cn(
            'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm relative',
            config.bg
          )}
        >
          <StatusIcon className={cn('w-6 h-6', config.color)} />
          {isActive && job.status !== 'queued' && !prefersReducedMotion && (
            <motion.span
              className="absolute inset-0 rounded-xl"
              animate={{
                boxShadow: [
                  `0 0 0 0px ${job.status === 'uploading' ? 'rgba(124, 58, 237, 0.3)' : 'rgba(8, 145, 178, 0.3)'}`,
                  `0 0 0 6px ${job.status === 'uploading' ? 'rgba(124, 58, 237, 0)' : 'rgba(8, 145, 178, 0)'}`,
                  `0 0 0 0px ${job.status === 'uploading' ? 'rgba(124, 58, 237, 0.3)' : 'rgba(8, 145, 178, 0.3)'}`,
                ],
              }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-text-primary text-[15px] font-semibold">{job.display_name}</h3>
              <p className="text-text-secondary text-sm mt-0.5">
                {job.publisher}
                {job.app_source !== 'store' && job.installer_type && (
                  <><span className="text-overlay/20"> | </span>v{job.version}</>
                )}
                <span className="text-overlay/20"> | </span>{job.architecture}
              </p>
              {showOwner && job.user_email && (
                <p className="text-text-muted text-xs mt-0.5">
                  <T>Deployed by <Var>{job.user_email}</Var></T>
                </p>
              )}
              {/* Assignments */}
              {job.package_config?.assignments && job.package_config.assignments.length > 0 && (
                <div className="flex items-center gap-2 mt-2">
                  {job.package_config.assignments.map((assignment, idx) => (
                    <span
                      key={idx}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border',
                        assignment.intent === 'required'
                          ? 'bg-accent-cyan/10 text-accent-cyan border-accent-cyan/20'
                          : assignment.intent === 'available'
                            ? 'bg-status-success/10 text-status-success border-status-success/20'
                            : 'bg-status-error/10 text-status-error border-status-error/20'
                      )}
                    >
                      {assignment.type === 'allUsers' && <Users className="w-3 h-3" />}
                      {assignment.type === 'allDevices' && <Monitor className="w-3 h-3" />}
                      {assignment.type === 'group' && <UserCircle className="w-3 h-3" />}
                      {assignment.type === 'allUsers' && <T>All Users</T>}
                      {assignment.type === 'allDevices' && <T>All Devices</T>}
                      {assignment.type === 'group' && (assignment.groupName || <T>Group</T>)}
                      <span className="text-text-muted">({assignment.intent})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canRemove && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn(
                        isDismissable
                          ? "border-overlay/10 text-text-secondary hover:bg-overlay/10 hover:border-black/20"
                          : "border-status-error/30 text-status-error hover:bg-status-error/10 hover:border-status-error/50"
                      )}
                      disabled={isCancelling}
                    >
                      {isCancelling ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : isDismissable ? (
                        <XCircle className="w-4 h-4 mr-2" />
                      ) : (
                        <Ban className="w-4 h-4 mr-2" />
                      )}
                      {isDismissable ? <T>Dismiss</T> : <T>Cancel</T>}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {isDismissable ? <T>Dismiss Job?</T> : <T>Cancel Upload?</T>}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {isDismissable
                          ? <T>Dismiss <Var>{job.display_name}</Var> from this list? Its deployment audit and update records will be preserved.</T>
                          : <T>Are you sure you want to cancel the upload for <Var>{job.display_name}</Var>? This action cannot be undone.</T>
                        }
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {isDismissable ? <T>Keep</T> : <T>Keep Running</T>}
                      </AlertDialogCancel>
                      <AlertDialogAction onClick={() => onCancel(job.id, isDismissable)}>
                        {isDismissable ? <T>Dismiss</T> : <T>Cancel Upload</T>}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <span
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 relative overflow-hidden',
                  config.bg,
                  config.color
                )}
              >
                {isActive && job.status !== 'queued' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : job.status === 'queued' ? (
                  <Clock className="w-3 h-3" />
                ) : (
                  <StatusIcon className="w-3 h-3" />
                )}
                {config.label}
                {isActive && !prefersReducedMotion && (
                  <motion.span
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear', repeatDelay: 1 }}
                  />
                )}
              </span>
              {isStale && (
                <span
                  className="px-2 py-1 rounded-full text-xs font-medium bg-status-warning/10 text-status-warning cursor-help"
                  title="This job has been inactive for over 75 minutes. The workflow may have stalled. Refresh before cancelling or retrying."
                >
                  <T>Stale</T>
                </span>
              )}
            </div>
          </div>

          {/* Progress Stepper for active and failed jobs */}
          {(isActive || job.status === 'failed') && (
            <ProgressStepper
              progress={job.progress_percent}
              status={job.status}
              statusMessage={job.status_message}
              startTime={job.packaging_started_at || job.created_at}
              endTime={job.status === 'failed' ? job.completed_at : null}
              errorStage={job.error_stage}
            />
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
            <span title={job.id} translate="no">Support ID: {job.id.slice(0, 8)}</span>
          </div>

          {/* Error message */}
          {job.status === 'failed' && (job.error_message || job.error_code) && (
            <ErrorDisplay
              errorMessage={job.error_message}
              errorStage={job.error_stage}
              errorCategory={job.error_category}
              errorCode={job.error_code}
              errorDetails={job.error_details}
            />
          )}

          {/* Retry button for failures */}
          {job.status === 'failed' && (
            <div className="mt-3">
              <Button
                size="sm"
                variant="outline"
                className="border-accent-cyan/30 text-accent-cyan bg-accent-cyan/5 hover:bg-accent-cyan/10"
                onClick={() => onRedeploy(job, false)}
                disabled={isRedeploying}
              >
                {isRedeploying ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <RefreshCw className="w-3 h-3 mr-1.5" />}
                <T>Retry safely</T>
              </Button>
            </div>
          )}

          {/* Cancelled info */}
          {job.status === 'cancelled' && (
            <div className="mt-4 p-3 bg-status-warning/10 border border-status-warning/20 rounded-lg">
              <div className="flex items-start gap-2">
                <Ban className="w-4 h-4 text-status-warning flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-status-warning">
                    <T>This job was cancelled</T>
                    {job.cancelled_by && <> <T>by <Var>{job.cancelled_by}</Var></T></>}
                  </p>
                  {job.cancelled_at && (
                    <p className="text-status-warning/70 text-xs mt-1">
                      <T>Cancelled at:</T> {new Date(job.cancelled_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Duplicate found - show existing app link and force deploy option */}
          {job.status === 'duplicate_skipped' && (() => {
            const details = job.error_details as Record<string, unknown> | undefined;
            const existingVersion = details?.existingVersion ? String(details.existingVersion) : null;
            return (
            <div className="mt-4 p-3 bg-status-warning/10 border border-status-warning/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-status-warning flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-status-warning font-medium text-sm">
                    <T>Duplicate app already exists in Intune</T>
                  </p>
                  <p className="text-status-warning/70 text-xs mt-1">
                    <T>An app with the same name and Winget ID was found in your tenant.</T>
                    {existingVersion && (
                      <span> <T>Existing version: <Var>{existingVersion}</Var></T></span>
                    )}
                  </p>
                  <div className="flex items-center gap-3 mt-3">
                    {job.intune_app_url && (
                      <a
                        href={job.intune_app_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-status-warning/20 text-status-warning hover:bg-status-warning/30 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <T>View existing app</T>
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-accent-cyan/30 text-accent-cyan hover:bg-accent-cyan/10 hover:border-accent-cyan/50 text-xs"
                      onClick={() => onRedeploy(job, true)}
                      disabled={isRedeploying}
                    >
                      {isRedeploying ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                      ) : (
                        <Play className="w-3 h-3 mr-1.5" />
                      )}
                      <T>Deploy as new app anyway</T>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            );
          })()}

          {/* Warnings - partial success (e.g., assignments could not be applied) */}
          {(() => {
            const warnings = Array.isArray(job.warnings) ? job.warnings.filter((w): w is string => typeof w === 'string') : [];
            return warnings.length > 0 && job.status === 'deployed' ? (
            <div className="mt-4 p-3 bg-status-warning/[0.08] border border-status-warning/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
                <div className="text-sm text-text-secondary">
                  {warnings.map((warning, i) => (
                    <p key={i} className={i > 0 ? 'mt-1' : ''}>{warning}</p>
                  ))}
                </div>
              </div>
            </div>
            ) : null;
          })()}

          {/* Success - deployed to Intune */}
          {job.intune_app_url && job.status !== 'duplicate_skipped' && (
            <div className="mt-4 p-3 bg-status-success/[0.05] border border-status-success/10 rounded-lg">
              <a
                href={job.intune_app_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-accent-cyan hover:text-accent-cyan-bright text-sm font-medium transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <T>View in Intune Portal</T>
                <ChevronRight className="w-4 h-4" />
              </a>
              {job.intune_app_id && job.status === 'deployed' && (
                <EspProfileSelector mode="post-deploy" intuneAppId={job.intune_app_id} />
              )}
            </div>
          )}

          {/* Timestamps */}
          <div className="mt-5 pt-4 border-t border-overlay/[0.05] flex items-center gap-4 text-xs text-text-muted">
            <span title={new Date(job.created_at).toLocaleString()}>
              <T>Created:</T> {formatRelativeTime(job.created_at)}
            </span>
            {job.completed_at && (
              <span title={new Date(job.completed_at).toLocaleString()}>
                <T>Completed:</T> {formatRelativeTime(job.completed_at)}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
