'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Package,
  Building2,
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';

interface BatchDeploymentItem {
  id: string;
  batch_id: string;
  tenant_id: string;
  tenant_display_name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  packaging_job_id: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface BatchDeployment {
  id: string;
  organization_id: string;
  winget_id: string;
  display_name: string;
  version: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
  total_tenants: number;
  completed_tenants: number;
  failed_tenants: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  items: BatchDeploymentItem[];
}

interface BatchProgressTrackerProps {
  batchId: string;
}

export function BatchProgressTracker({ batchId }: BatchProgressTrackerProps) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();

  const { data, isLoading, error } = useQuery<{ batch: BatchDeployment }>({
    queryKey: ['batch-deployment', batchId],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch(`/api/msp/batch-deployments/${batchId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch batch deployment');
      }

      return response.json();
    },
    enabled: isAuthenticated && !!batchId,
    refetchInterval: (query) => {
      const batch = query.state.data?.batch;
      // Poll more frequently if the batch is in progress
      if (batch?.status === 'in_progress' || batch?.status === 'pending') {
        return 5000; // 5 seconds
      }
      return false; // Stop polling when complete
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-accent-cyan animate-spin" />
      </div>
    );
  }

  if (error || !data?.batch) {
    return (
      <div className="p-6 rounded-xl glass-light border border-red-500/20 text-center">
        <XCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-sm text-red-400">Failed to load batch deployment</p>
      </div>
    );
  }

  const batch = data.batch;
  const progressPercent = batch.total_tenants > 0
    ? Math.round(((batch.completed_tenants + batch.failed_tenants) / batch.total_tenants) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-5 h-5 text-accent-cyan" />
            <h3 className="text-lg font-medium text-text-primary">{batch.display_name}</h3>
          </div>
          <p className="text-sm text-text-muted">
            {batch.winget_id} v{batch.version}
          </p>
        </div>
        <StatusBadge status={batch.status} />
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Progress</span>
          <span className="text-text-primary font-medium">{progressPercent}%</span>
        </div>
        <div className="h-2 bg-black/10 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-500',
              batch.status === 'failed' || batch.status === 'cancelled'
                ? 'bg-red-500'
                : 'bg-gradient-to-r from-accent-cyan to-accent-violet'
            )}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>{batch.completed_tenants + batch.failed_tenants} of {batch.total_tenants} tenants</span>
          <span>{formatRelativeTime(batch.created_at)}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-lg bg-black/5 text-center">
          <p className="text-2xl font-bold text-emerald-400">{batch.completed_tenants}</p>
          <p className="text-xs text-text-muted">Completed</p>
        </div>
        <div className="p-4 rounded-lg bg-black/5 text-center">
          <p className="text-2xl font-bold text-red-400">{batch.failed_tenants}</p>
          <p className="text-xs text-text-muted">Failed</p>
        </div>
        <div className="p-4 rounded-lg bg-black/5 text-center">
          <p className="text-2xl font-bold text-amber-400">
            {batch.total_tenants - batch.completed_tenants - batch.failed_tenants}
          </p>
          <p className="text-xs text-text-muted">Pending</p>
        </div>
      </div>

      {/* Tenant list */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-secondary flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          Tenant Status
        </h4>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-black/10 divide-y divide-black/5">
          {batch.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 hover:bg-black/5 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <ItemStatusIcon status={item.status} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {item.tenant_display_name}
                  </p>
                  {item.error_message && (
                    <p className="text-xs text-red-400 truncate">{item.error_message}</p>
                  )}
                </div>
              </div>
              <span className="text-xs text-text-muted flex-shrink-0">
                {item.completed_at
                  ? formatRelativeTime(item.completed_at)
                  : item.started_at
                  ? 'In progress...'
                  : 'Pending'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: BatchDeployment['status'] }) {
  const config = {
    pending: { label: 'Pending', className: 'bg-amber-500/20 text-amber-400' },
    in_progress: { label: 'In Progress', className: 'bg-blue-500/20 text-blue-400' },
    completed: { label: 'Completed', className: 'bg-emerald-500/20 text-emerald-400' },
    cancelled: { label: 'Cancelled', className: 'bg-gray-500/20 text-gray-400' },
    failed: { label: 'Failed', className: 'bg-red-500/20 text-red-400' },
  };

  const { label, className } = config[status] || config.pending;

  return (
    <span className={cn('px-3 py-1 rounded-full text-xs font-medium', className)}>
      {label}
    </span>
  );
}

function ItemStatusIcon({ status }: { status: BatchDeploymentItem['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />;
    case 'failed':
      return <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />;
    case 'in_progress':
      return <Loader2 className="w-5 h-5 text-blue-400 animate-spin flex-shrink-0" />;
    case 'skipped':
      return <Clock className="w-5 h-5 text-gray-400 flex-shrink-0" />;
    default:
      return <Clock className="w-5 h-5 text-amber-400 flex-shrink-0" />;
  }
}
