'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Building2,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  FlaskConical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { cn } from '@/lib/utils';
import type { CrossTenantJobsTableProps, MspJob, GetMspJobsResponse } from '@/types/msp';

export function CrossTenantJobsTable({ jobs: initialJobs, isLoading: externalLoading, onRefresh }: CrossTenantJobsTableProps) {
  const { getAccessToken } = useMicrosoftAuth();
  const [jobs, setJobs] = useState<MspJob[]>(initialJobs || []);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async (pageNum: number = 1) => {
    setIsLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`/api/msp/jobs?page=${pageNum}&limit=20`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch jobs');
      }

      const data: GetMspJobsResponse = await response.json();
      setJobs(data.jobs);
      setPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (!initialJobs) {
      fetchJobs();
    }
  }, [initialJobs, fetchJobs]);

  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    } else {
      fetchJobs(page);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'packaging':
      case 'uploading':
        return <Loader2 className="w-4 h-4 text-accent-cyan animate-spin" />;
      case 'testing':
        return <FlaskConical className="w-4 h-4 text-amber-500" />;
      default:
        return <Clock className="w-4 h-4 text-text-muted" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'packaging':
        return 'Packaging';
      case 'uploading':
        return 'Uploading';
      case 'testing':
        return 'Testing';
      case 'queued':
        return 'Queued';
      default:
        return status;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than 1 minute
    if (diff < 60000) {
      return 'Just now';
    }

    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }

    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }

    // More than 24 hours
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const loading = isLoading || externalLoading;

  return (
    <div className="rounded-xl bg-overlay/5 border border-overlay/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-overlay/5">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-accent-cyan" />
          <h3 className="font-medium text-text-primary">Recent Jobs Across All Tenants</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
          className="text-text-secondary hover:text-text-primary"
        >
          <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && jobs.length === 0 && (
        <div className="p-8 text-center">
          <Loader2 className="w-8 h-8 text-accent-cyan animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading jobs...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && jobs.length === 0 && !error && (
        <div className="p-8 text-center">
          <Package className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-secondary mb-1">No jobs found</p>
          <p className="text-sm text-text-muted">
            Jobs will appear here after you deploy packages to managed tenants.
          </p>
        </div>
      )}

      {/* Jobs table */}
      {jobs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] md:min-w-0">
            <thead>
              <tr className="border-b border-overlay/5">
                <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                  Package
                </th>
                <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                  Tenant
                </th>
                <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                  Time
                </th>
                <th className="text-right text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-overlay/5 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-accent-cyan/20 flex items-center justify-center flex-shrink-0">
                        <Package className="w-4 h-4 text-accent-cyan" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {job.display_name}
                        </p>
                        <p className="text-xs text-text-muted truncate">
                          {job.winget_id} v{job.version}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-text-muted" />
                      <span className="text-sm text-text-secondary">
                        {job.tenant_display_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <span className={cn(
                        'text-sm',
                        job.status === 'completed' && 'text-green-500',
                        job.status === 'failed' && 'text-red-500',
                        (job.status === 'packaging' || job.status === 'uploading') && 'text-accent-cyan',
                        job.status === 'testing' && 'text-amber-500',
                        job.status === 'queued' && 'text-text-muted'
                      )}>
                        {getStatusText(job.status)}
                      </span>
                    </div>
                    {job.error_message && (
                      <p className="text-xs text-red-400 mt-1 truncate max-w-[200px]">
                        {job.error_message}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-text-muted">
                      {formatDate(job.created_at)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {job.intune_app_url && (
                      <a
                        href={job.intune_app_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent-cyan hover:text-accent-cyan-bright transition-colors"
                      >
                        View in Intune
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between p-4 border-t border-overlay/5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchJobs(page - 1)}
            disabled={page <= 1 || loading}
            className="text-text-secondary hover:text-text-primary"
          >
            Previous
          </Button>
          <span className="text-sm text-text-muted">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchJobs(page + 1)}
            disabled={page >= totalPages || loading}
            className="text-text-secondary hover:text-text-primary"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export default CrossTenantJobsTable;
