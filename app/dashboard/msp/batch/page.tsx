'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useMsp } from '@/contexts/MspContext';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { PageHeader, SkeletonGrid } from '@/components/dashboard';
import { BatchProgressTracker } from '@/components/msp/BatchProgressTracker';
import { Button } from '@/components/ui/button';
import {
  Layers,
  Plus,
  Package,
  Building2,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';

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
  completed_at: string | null;
  created_by_email: string;
}

interface BatchDeploymentsResponse {
  batches: BatchDeployment[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export default function BatchDeploymentsPage() {
  const router = useRouter();
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, isLoadingOrganization, organization } = useMsp();
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  // Redirect to setup if not an MSP user
  useEffect(() => {
    if (!isLoadingOrganization && !isMspUser) {
      router.push('/dashboard/msp/setup');
    }
  }, [isLoadingOrganization, isMspUser, router]);

  const { data, isLoading, error } = useQuery<BatchDeploymentsResponse>({
    queryKey: ['batch-deployments'],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch('/api/msp/batch-deployments?limit=20', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch batch deployments');
      }

      return response.json();
    },
    enabled: isAuthenticated && isMspUser,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Loading state
  if (isLoadingOrganization) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-black/10 rounded animate-pulse" />
        <SkeletonGrid count={4} columns={2} variant="content" />
      </div>
    );
  }

  // Not an MSP user
  if (!isMspUser || !organization) {
    return null;
  }

  const batches = data?.batches || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      <PageHeader
        title="Batch Deployments"
        description="Deploy applications to multiple tenants at once"
        icon={Layers}
        actions={
          <Link href="/dashboard/msp/batch/new">
            <Button className="bg-gradient-to-r from-accent-cyan to-accent-violet text-bg-elevated hover:opacity-90">
              <Plus className="w-4 h-4 mr-2" />
              New Batch
            </Button>
          </Link>
        }
      />

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Batch list */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-text-secondary">Recent Batches</h3>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 glass-light rounded-xl border border-black/5 animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6 rounded-xl glass-light border border-red-500/20 text-center">
              <XCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <p className="text-sm text-red-400">Failed to load batch deployments</p>
            </div>
          ) : batches.length === 0 ? (
            <div className="p-8 rounded-xl glass-light border border-black/5 text-center">
              <Layers className="w-10 h-10 text-text-muted mx-auto mb-3" />
              <p className="text-sm text-text-secondary mb-4">No batch deployments yet</p>
              <Link href="/dashboard/msp/batch/new">
                <Button size="sm" variant="outline" className="border-black/20">
                  <Plus className="w-4 h-4 mr-2" />
                  Create your first batch
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {batches.map((batch) => (
                <button
                  key={batch.id}
                  onClick={() => setSelectedBatchId(batch.id)}
                  className={cn(
                    'w-full p-4 rounded-xl glass-light border transition-all text-left',
                    selectedBatchId === batch.id
                      ? 'border-accent-cyan/50 shadow-glow-cyan'
                      : 'border-black/5 hover:border-black/10'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Package className="w-4 h-4 text-accent-cyan flex-shrink-0" />
                        <p className="text-sm font-medium text-text-primary truncate">
                          {batch.display_name}
                        </p>
                      </div>
                      <p className="text-xs text-text-muted mb-2">
                        {batch.winget_id} v{batch.version}
                      </p>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="flex items-center gap-1 text-text-secondary">
                          <Building2 className="w-3 h-3" />
                          {batch.total_tenants} tenants
                        </span>
                        <span className="flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" />
                          {batch.completed_tenants}
                        </span>
                        {batch.failed_tenants > 0 && (
                          <span className="flex items-center gap-1 text-red-400">
                            <XCircle className="w-3 h-3" />
                            {batch.failed_tenants}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <BatchStatusBadge status={batch.status} />
                      <span className="text-xs text-text-muted">
                        {formatRelativeTime(batch.created_at)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="p-6 rounded-xl glass-light border border-black/5">
          {selectedBatchId ? (
            <BatchProgressTracker batchId={selectedBatchId} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
              <Layers className="w-12 h-12 text-text-muted mb-4" />
              <p className="text-text-secondary mb-2">Select a batch to view details</p>
              <p className="text-xs text-text-muted">
                Click on a batch from the list to see its progress
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function BatchStatusBadge({ status }: { status: BatchDeployment['status'] }) {
  const config = {
    pending: { label: 'Pending', className: 'bg-amber-500/20 text-amber-400', icon: Clock },
    in_progress: { label: 'Running', className: 'bg-blue-500/20 text-blue-400', icon: Loader2 },
    completed: { label: 'Done', className: 'bg-emerald-500/20 text-emerald-400', icon: CheckCircle2 },
    cancelled: { label: 'Cancelled', className: 'bg-gray-500/20 text-gray-400', icon: XCircle },
    failed: { label: 'Failed', className: 'bg-red-500/20 text-red-400', icon: XCircle },
  };

  const { label, className, icon: Icon } = config[status] || config.pending;

  return (
    <span className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', className)}>
      <Icon className={cn('w-3 h-3', status === 'in_progress' && 'animate-spin')} />
      {label}
    </span>
  );
}
