'use client';

import { useState, useEffect, useCallback } from 'react';
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
  FlaskConical,
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
import { ProgressStepper } from '@/components/ProgressStepper';
import { TestSubStepper } from '@/components/TestSubStepper';
import { ErrorDisplay } from '@/components/ErrorDisplay';
import { PageHeader, AnimatedStatCard, StatCardGrid, AnimatedEmptyState, SkeletonGrid } from '@/components/dashboard';
import type { PackageAssignment } from '@/types/upload';

interface PackagingJob {
  id: string;
  user_id: string;
  winget_id: string;
  version: string;
  display_name: string;
  publisher: string;
  architecture: string;
  installer_type: string;
  status: 'queued' | 'packaging' | 'testing' | 'completed' | 'failed' | 'uploading' | 'deployed' | 'cancelled' | 'duplicate_skipped';
  status_message?: string;
  progress_percent: number;
  error_message?: string;
  error_stage?: string;
  error_category?: string;
  error_code?: string;
  error_details?: Record<string, unknown>;
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
  const { user, getAccessToken } = useMicrosoftAuth();
  const prefersReducedMotion = useReducedMotion();

  const [jobs, setJobs] = useState<PackagingJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [redeployingJobId, setRedeployingJobId] = useState<string | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);

  // Get job IDs and status filter from URL params
  const highlightedJobIds = searchParams.get('jobs')?.split(',') || [];
  const urlStatus = searchParams.get('status');
  const initialFilter = (['all', 'active', 'completed', 'failed', 'pending'] as const).includes(
    urlStatus as 'all' | 'active' | 'completed' | 'failed' | 'pending'
  )
    ? (urlStatus === 'pending' ? 'active' : urlStatus as 'all' | 'active' | 'completed' | 'failed')
    : 'all';
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>(initialFilter);

  const fetchJobs = useCallback(async (showRefreshing = false) => {
    if (!user?.id) return;

    if (showRefreshing) {
      setIsRefreshing(true);
    }

    try {
      const response = await fetch(`/api/package?userId=${user.id}`);

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
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user?.id]);

  // Initial load
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Auto-refresh for active jobs
  useEffect(() => {
    const hasActiveJobs = jobs.some((job) =>
      ['queued', 'packaging', 'testing', 'uploading'].includes(job.status)
    );

    if (!hasActiveJobs) return;

    const interval = setInterval(() => {
      fetchJobs();
    }, 2000); // Poll every 2 seconds for active jobs

    return () => clearInterval(interval);
  }, [jobs, fetchJobs]);

  const handleRefresh = () => {
    fetchJobs(true);
  };

  const handleCancelJob = async (jobId: string, dismiss?: boolean) => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setCancellingJobId(jobId);
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

      // Refresh jobs to get updated status
      await fetchJobs();
    } catch (err) {
      console.error('Failed to cancel job:', err);
      setError(err instanceof Error ? err.message : `Failed to ${dismiss ? 'dismiss' : 'cancel'} job`);
    } finally {
      setCancellingJobId(null);
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

  const handleForceRedeploy = async (job: PackagingJob) => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;

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
          forceCreate: true,
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
    } catch (err) {
      console.error('Failed to force redeploy:', err);
      setError(err instanceof Error ? err.message : 'Failed to redeploy');
    } finally {
      setRedeployingJobId(null);
    }
  };

  const filteredJobs = jobs.filter((job) => {
    switch (filter) {
      case 'active':
        return ['queued', 'packaging', 'testing', 'uploading'].includes(job.status);
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
      ['queued', 'packaging', 'testing', 'uploading'].includes(j.status)
    ).length,
    completed: jobs.filter((j) => ['completed', 'deployed', 'duplicate_skipped'].includes(j.status)).length,
    failed: jobs.filter((j) => ['failed', 'cancelled'].includes(j.status)).length,
  };

  const filterButtons = ['all', 'active', 'completed', 'failed'] as const;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Uploads"
          description="Monitor your package deployments to Intune"
        />
        <SkeletonGrid count={4} columns={4} variant="stat" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-light rounded-xl p-5 border border-overlay/5 animate-pulse h-32" />
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
        badge={stats.active > 0 ? { text: 'Live', variant: 'success' as const } : undefined}
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
                    Clear History
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear Upload History?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove all completed, failed, cancelled, and deployed jobs from your history. Active jobs (queued, packaging, uploading) will not be affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep History</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearHistory}>
                      Clear All
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
              Refresh
            </Button>
          </div>
        }
      />

      {/* Error message */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-start gap-3 p-4 bg-status-error/10 border border-status-error/20 rounded-lg"
          >
            <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-status-error font-medium">Error loading jobs</p>
              <p className="text-status-error/70 text-sm mt-1">{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <StatCardGrid columns={4}>
        <AnimatedStatCard
          title="Total"
          value={stats.total}
          icon={Package}
          color="cyan"
          delay={0}
          onClick={() => setFilter('all')}
          isActive={filter === 'all'}
        />
        <AnimatedStatCard
          title="Active"
          value={stats.active}
          icon={Clock}
          color="violet"
          delay={0.1}
          onClick={() => setFilter('active')}
          isActive={filter === 'active'}
        />
        <AnimatedStatCard
          title="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          color="success"
          delay={0.2}
          onClick={() => setFilter('completed')}
          isActive={filter === 'completed'}
        />
        <AnimatedStatCard
          title="Failed"
          value={stats.failed}
          icon={XCircle}
          color="error"
          delay={0.3}
          onClick={() => setFilter('failed')}
          isActive={filter === 'failed'}
        />
      </StatCardGrid>

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
              'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:outline-none',
              filter === f
                ? 'bg-gradient-to-r from-accent-cyan to-accent-violet text-bg-elevated'
                : 'bg-overlay/5 text-text-secondary hover:text-text-primary hover:bg-overlay/10 border border-overlay/5'
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </motion.div>

      {/* Jobs list */}
      {filteredJobs.length === 0 ? (
        <AnimatedEmptyState
          icon={Upload}
          title={filter === 'all' ? 'No uploads yet' : `No ${filter} uploads`}
          description={
            filter === 'all'
              ? 'Add packages from the App Catalog to get started'
              : `You have no ${filter} uploads to display`
          }
          color="cyan"
          showOrbs={filter === 'all'}
          action={
            filter === 'all'
              ? {
                  label: 'Browse App Catalog',
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
                onForceRedeploy={handleForceRedeploy}
                isRedeploying={redeployingJobId === job.id}
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
  onForceRedeploy,
  isRedeploying,
}: {
  job: PackagingJob;
  index: number;
  isHighlighted?: boolean;
  onCancel: (jobId: string, dismiss?: boolean) => void;
  isCancelling?: boolean;
  onForceRedeploy: (job: PackagingJob) => void;
  isRedeploying?: boolean;
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
    testing: {
      icon: FlaskConical,
      label: 'Testing',
      color: 'text-status-warning',
      bg: 'bg-status-warning/10',
      border: 'border-l-status-warning',
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
  const isActive = ['queued', 'packaging', 'testing', 'uploading'].includes(job.status);
  const isStale = isActive && (Date.now() - new Date(job.updated_at).getTime()) > 30 * 60 * 1000;
  // Allow cancelling active jobs or dismissing completed/failed jobs
  const isCancellable = ['queued', 'packaging', 'testing', 'uploading'].includes(job.status);
  const isDismissable = ['completed', 'failed', 'duplicate_skipped'].includes(job.status);
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
        'glass-light border border-l-[3px] rounded-xl p-5 transition-all contain-layout',
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
            'w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0',
            config.bg
          )}
        >
          <StatusIcon className={cn('w-6 h-6', config.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-text-primary font-medium">{job.display_name}</h3>
              <p className="text-text-muted text-sm">
                {job.publisher} &middot; v{job.version} &middot; {job.architecture}
              </p>
              {/* Assignments */}
              {job.package_config?.assignments && job.package_config.assignments.length > 0 && (
                <div className="flex items-center gap-2 mt-2">
                  {job.package_config.assignments.map((assignment, idx) => (
                    <span
                      key={idx}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium',
                        assignment.intent === 'required'
                          ? 'bg-accent-cyan/10 text-accent-cyan'
                          : assignment.intent === 'available'
                            ? 'bg-status-success/10 text-status-success'
                            : 'bg-status-error/10 text-status-error'
                      )}
                    >
                      {assignment.type === 'allUsers' && <Users className="w-3 h-3" />}
                      {assignment.type === 'allDevices' && <Monitor className="w-3 h-3" />}
                      {assignment.type === 'group' && <UserCircle className="w-3 h-3" />}
                      {assignment.type === 'allUsers' && 'All Users'}
                      {assignment.type === 'allDevices' && 'All Devices'}
                      {assignment.type === 'group' && (assignment.groupName || 'Group')}
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
                      {isDismissable ? 'Dismiss' : 'Cancel'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {isDismissable ? 'Dismiss Job?' : 'Cancel Upload?'}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {isDismissable
                          ? `Are you sure you want to dismiss ${job.display_name} from your list? This will permanently remove it.`
                          : `Are you sure you want to cancel the upload for ${job.display_name}? This action cannot be undone.`
                        }
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {isDismissable ? 'Keep' : 'Keep Running'}
                      </AlertDialogCancel>
                      <AlertDialogAction onClick={() => onCancel(job.id, isDismissable)}>
                        {isDismissable ? 'Dismiss' : 'Cancel Upload'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <span
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5',
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
              </span>
              {isStale && (
                <span
                  className="px-2 py-1 rounded-full text-xs font-medium bg-status-warning/10 text-status-warning cursor-help"
                  title="This job has been inactive for over 30 minutes. The pipeline may have stalled. Consider cancelling and retrying."
                >
                  Stale
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

          {/* Test sub-stepper for testing phase */}
          <AnimatePresence>
            {(job.status === 'testing' || (job.status === 'failed' && job.error_stage === 'test')) && (
              <TestSubStepper
                statusMessage={job.status_message}
                isJobFailed={job.status === 'failed'}
              />
            )}
          </AnimatePresence>

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

          {/* Retry button for failed jobs */}
          {job.status === 'failed' && (
            <div className="mt-3 flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                className="border-accent-cyan/30 text-accent-cyan hover:bg-accent-cyan/10"
                onClick={() => onForceRedeploy(job)}
                disabled={isRedeploying}
              >
                {isRedeploying ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <RefreshCw className="w-3 h-3 mr-1.5" />}
                Retry Deployment
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
                    This job was cancelled
                    {job.cancelled_by && ` by ${job.cancelled_by}`}
                  </p>
                  {job.cancelled_at && (
                    <p className="text-status-warning/70 text-xs mt-1">
                      Cancelled at: {new Date(job.cancelled_at).toLocaleString()}
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
                    Duplicate app already exists in Intune
                  </p>
                  <p className="text-status-warning/70 text-xs mt-1">
                    An app with the same name and Winget ID was found in your tenant.
                    {existingVersion && (
                      <span> Existing version: {existingVersion}</span>
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
                        View existing app
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-accent-cyan/30 text-accent-cyan hover:bg-accent-cyan/10 hover:border-accent-cyan/50 text-xs"
                      onClick={() => onForceRedeploy(job)}
                      disabled={isRedeploying}
                    >
                      {isRedeploying ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                      ) : (
                        <Play className="w-3 h-3 mr-1.5" />
                      )}
                      Deploy as new app anyway
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            );
          })()}

          {/* Success - deployed to Intune */}
          {job.intune_app_url && job.status !== 'duplicate_skipped' && (
            <div className="mt-4">
              <a
                href={job.intune_app_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-accent-cyan hover:text-accent-cyan-bright text-sm transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                View in Intune Portal
                <ChevronRight className="w-4 h-4" />
              </a>
            </div>
          )}

          {/* Timestamps */}
          <div className="mt-4 flex items-center gap-4 text-xs text-text-muted">
            <span title={new Date(job.created_at).toLocaleString()}>
              Created: {formatRelativeTime(job.created_at)}
            </span>
            {job.completed_at && (
              <span title={new Date(job.completed_at).toLocaleString()}>
                Completed: {formatRelativeTime(job.completed_at)}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
