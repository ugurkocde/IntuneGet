'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
  status: 'queued' | 'packaging' | 'completed' | 'failed' | 'uploading' | 'deployed' | 'cancelled';
  status_message?: string;
  progress_percent: number;
  error_message?: string;
  error_stage?: string;
  error_category?: string;
  error_code?: string;
  error_details?: Record<string, unknown>;
  pipeline_run_id?: number;
  pipeline_run_url?: string;
  intunewin_url?: string;
  intune_app_id?: string;
  intune_app_url?: string;
  created_at: string;
  packaging_started_at?: string;
  packaging_completed_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  cancelled_by?: string;
  package_config?: {
    assignments?: PackageAssignment[];
  };
}

export default function UploadsPage() {
  const searchParams = useSearchParams();
  const { user, getAccessToken } = useMicrosoftAuth();
  const prefersReducedMotion = useReducedMotion();

  const [jobs, setJobs] = useState<PackagingJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>('all');
  const [error, setError] = useState<string | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);

  // Get job IDs from URL if present (from recent deployment)
  const highlightedJobIds = searchParams.get('jobs')?.split(',') || [];

  const fetchJobs = useCallback(async (showRefreshing = false) => {
    if (!user?.id) return;

    if (showRefreshing) {
      setIsRefreshing(true);
    }

    try {
      const response = await fetch(`/api/package?userId=${user.id}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch jobs');
      }

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
      ['queued', 'packaging', 'uploading'].includes(job.status)
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

  const handleCancelJob = async (jobId: string) => {
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
        body: JSON.stringify({ jobId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel job');
      }

      // Refresh jobs to get updated status
      await fetchJobs();
    } catch (err) {
      console.error('Failed to cancel job:', err);
      setError(err instanceof Error ? err.message : 'Failed to cancel job');
    } finally {
      setCancellingJobId(null);
    }
  };

  const filteredJobs = jobs.filter((job) => {
    switch (filter) {
      case 'active':
        return ['queued', 'packaging', 'uploading'].includes(job.status);
      case 'completed':
        return ['completed', 'deployed'].includes(job.status);
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
    completed: jobs.filter((j) => ['completed', 'deployed'].includes(j.status)).length,
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
            <div key={i} className="glass-light rounded-xl p-5 border border-black/5 animate-pulse h-32" />
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
        actions={
          <Button
            onClick={handleRefresh}
            disabled={isRefreshing}
            variant="outline"
            className="border-black/10 text-text-secondary hover:bg-black/5 hover:border-black/20"
          >
            {isRefreshing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Refresh
          </Button>
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
        />
        <AnimatedStatCard
          title="Active"
          value={stats.active}
          icon={Clock}
          color="violet"
          delay={0.1}
        />
        <AnimatedStatCard
          title="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          color="success"
          delay={0.2}
        />
        <AnimatedStatCard
          title="Failed"
          value={stats.failed}
          icon={XCircle}
          color="error"
          delay={0.3}
        />
      </StatCardGrid>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex flex-wrap gap-2"
      >
        {filterButtons.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
              filter === f
                ? 'bg-gradient-to-r from-accent-cyan to-accent-violet text-bg-elevated'
                : 'bg-black/5 text-text-secondary hover:text-text-primary hover:bg-black/10 border border-black/5'
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
                  onClick: () => (window.location.href = '/dashboard/apps'),
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
}: {
  job: PackagingJob;
  index: number;
  isHighlighted?: boolean;
  onCancel: (jobId: string) => void;
  isCancelling?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();

  const statusConfig = {
    queued: {
      icon: Clock,
      label: 'Queued',
      color: 'text-text-secondary',
      bg: 'bg-black/5',
    },
    packaging: {
      icon: Package,
      label: 'Packaging',
      color: 'text-accent-cyan',
      bg: 'bg-accent-cyan/10',
    },
    uploading: {
      icon: Upload,
      label: 'Uploading',
      color: 'text-accent-violet',
      bg: 'bg-accent-violet/10',
    },
    completed: {
      icon: CheckCircle2,
      label: 'Packaged',
      color: 'text-status-success',
      bg: 'bg-status-success/10',
    },
    deployed: {
      icon: CheckCircle2,
      label: 'Deployed',
      color: 'text-status-success',
      bg: 'bg-status-success/10',
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      color: 'text-status-error',
      bg: 'bg-status-error/10',
    },
    cancelled: {
      icon: Ban,
      label: 'Cancelled',
      color: 'text-status-warning',
      bg: 'bg-status-warning/10',
    },
  };

  const config = statusConfig[job.status] || statusConfig.queued;
  const StatusIcon = config.icon;
  const isActive = ['queued', 'packaging', 'uploading'].includes(job.status);
  // Allow cancelling active jobs or dismissing completed/failed jobs
  const isCancellable = ['queued', 'packaging', 'uploading'].includes(job.status);
  const isDismissable = ['completed', 'failed'].includes(job.status);
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
        'glass-light border rounded-xl p-5 transition-all contain-layout',
        isHighlighted
          ? 'border-accent-cyan/50 ring-1 ring-accent-cyan/20 shadow-glow-cyan'
          : 'border-black/5 hover:border-black/10'
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
                          ? "border-black/10 text-text-secondary hover:bg-black/10 hover:border-black/20"
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
                          ? `Are you sure you want to dismiss ${job.display_name} from your list? This will mark it as cancelled.`
                          : `Are you sure you want to cancel the upload for ${job.display_name}? This action cannot be undone.`
                        }
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {isDismissable ? 'Keep' : 'Keep Running'}
                      </AlertDialogCancel>
                      <AlertDialogAction onClick={() => onCancel(job.id)}>
                        {isDismissable ? 'Dismiss' : 'Cancel Upload'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <span
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5',
                  config.bg,
                  config.color
                )}
              >
                {isActive && job.status !== 'queued' && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
                {config.label}
              </span>
            </div>
          </div>

          {/* Progress Stepper for active jobs */}
          {isActive && (
            <ProgressStepper
              progress={job.progress_percent}
              status={job.status}
              statusMessage={job.status_message}
              startTime={job.packaging_started_at || job.created_at}
              endTime={null}
            />
          )}

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

          {/* Package ready - show upload to Intune option */}
          {job.status === 'completed' && job.intunewin_url && !job.intune_app_id && (
            <div className="mt-4 p-3 bg-status-success/10 border border-status-success/20 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-status-success flex-shrink-0 mt-0.5" />
                  <p className="text-status-success text-sm">
                    Package ready! Click to upload to your Intune tenant.
                  </p>
                </div>
                <Button
                  size="sm"
                  className="bg-status-success hover:bg-status-success/90 text-white"
                  onClick={() => {
                  }}
                >
                  <Play className="w-3 h-3 mr-1" />
                  Upload to Intune
                </Button>
              </div>
            </div>
          )}

          {/* Success - deployed to Intune */}
          {job.intune_app_url && (
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

          {/* Pipeline link */}
          {job.pipeline_run_url && (
            <div className="mt-2">
              <a
                href={job.pipeline_run_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-text-muted hover:text-text-secondary text-xs transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                View Pipeline Run
              </a>
            </div>
          )}

          {/* Timestamps */}
          <div className="mt-4 flex items-center gap-4 text-xs text-text-muted">
            <span>Created: {new Date(job.created_at).toLocaleString()}</span>
            {job.completed_at && (
              <span>Completed: {new Date(job.completed_at).toLocaleString()}</span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
