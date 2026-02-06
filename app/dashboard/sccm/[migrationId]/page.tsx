'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  Wand2,
  ArrowRight,
  Link2,
  X,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { PageHeader, AnimatedStatCard, StatCardGrid, SkeletonGrid } from '@/components/dashboard';
import type { SccmMigration, SccmMatchStatus } from '@/types/sccm';

// Database row interface (snake_case as returned by Supabase)
interface SccmAppRow {
  id: string;
  migration_id: string;
  sccm_ci_id: string;
  display_name: string;
  manufacturer: string | null;
  version: string | null;
  technology: string;
  is_deployed: boolean;
  deployment_count: number;
  match_status: string;
  match_confidence: number | null;
  matched_winget_id: string | null;
  matched_winget_name: string | null;
  partial_matches: unknown[];
}

interface PageProps {
  params: Promise<{ migrationId: string }>;
}

export default function MigrationDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getAccessToken } = useMicrosoftAuth();

  const [migration, setMigration] = useState<SccmMigration | null>(null);
  const [apps, setApps] = useState<SccmAppRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchStatusFilter, setMatchStatusFilter] = useState<SccmMatchStatus | 'all'>('all');
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());

  const fetchMigration = useCallback(async () => {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Authentication required');

      const response = await fetch(`/api/sccm/migrations?id=${resolvedParams.migrationId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) throw new Error('Failed to fetch migration');

      const data = await response.json();
      setMigration(data.migration);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch migration');
    }
  }, [getAccessToken, resolvedParams.migrationId]);

  const fetchApps = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Authentication required');

      const params = new URLSearchParams({
        migrationId: resolvedParams.migrationId,
        limit: '100',
      });

      if (searchQuery) params.set('search', searchQuery);
      if (matchStatusFilter !== 'all') params.set('matchStatus', matchStatusFilter);

      const response = await fetch(`/api/sccm/match?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) throw new Error('Failed to fetch apps');

      const data = await response.json();
      setApps(data.apps || []);
      setTotal(data.total || 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch apps');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [getAccessToken, resolvedParams.migrationId, searchQuery, matchStatusFilter]);

  useEffect(() => {
    fetchMigration();
    fetchApps();
  }, [fetchMigration, fetchApps]);

  const handleRunMatching = async () => {
    setIsMatching(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Authentication required');

      const response = await fetch('/api/sccm/match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          migrationId: resolvedParams.migrationId,
          forceRematch: false,
        }),
      });

      if (!response.ok) throw new Error('Failed to run matching');

      // Refresh data
      await fetchMigration();
      await fetchApps();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Matching failed');
    } finally {
      setIsMatching(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedApps.size === apps.length) {
      setSelectedApps(new Set());
    } else {
      setSelectedApps(new Set(apps.map(a => a.id)));
    }
  };

  const handleSelectApp = (appId: string) => {
    const newSelected = new Set(selectedApps);
    if (newSelected.has(appId)) {
      newSelected.delete(appId);
    } else {
      newSelected.add(appId);
    }
    setSelectedApps(newSelected);
  };

  const handleMigrateSelected = () => {
    if (selectedApps.size === 0) return;
    const ids = Array.from(selectedApps).join(',');
    router.push(`/dashboard/sccm/${resolvedParams.migrationId}/migrate?apps=${ids}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-black/5 rounded animate-pulse" />
        <SkeletonGrid count={4} columns={4} variant="stat" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-20 bg-black/5 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!migration) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-status-error mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">Migration Not Found</h2>
        <Link href="/dashboard/sccm">
          <Button variant="outline">Back to Migrations</Button>
        </Link>
      </div>
    );
  }

  const matchedApps = apps.filter(a => a.match_status === 'matched');
  const partialApps = apps.filter(a => a.match_status === 'partial');
  const unmatchedApps = apps.filter(a => a.match_status === 'unmatched');
  const pendingMatch = apps.filter(a => a.match_status === 'pending');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/sccm">
          <Button variant="ghost" size="sm" className="text-text-secondary hover:text-text-primary">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      <PageHeader
        title={migration.name}
        description={migration.description || `${migration.totalApps} applications from SCCM`}
        gradient
        gradientColors="cyan"
        actions={
          <div className="flex items-center gap-3">
            <Button
              onClick={() => fetchApps(true)}
              disabled={isRefreshing}
              variant="outline"
              className="border-black/10 text-text-secondary"
            >
              {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
            <Button
              onClick={handleRunMatching}
              disabled={isMatching || pendingMatch.length === 0}
              variant="outline"
              className="border-accent-cyan/30 text-accent-cyan hover:bg-accent-cyan/10"
            >
              {isMatching ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4 mr-2" />
              )}
              Run Matching
            </Button>
            <Button
              onClick={handleMigrateSelected}
              disabled={selectedApps.size === 0}
              className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90"
            >
              Migrate ({selectedApps.size})
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        }
      />

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-start gap-3 p-4 bg-status-error/10 border border-status-error/20 rounded-lg"
          >
            <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0" />
            <p className="text-status-error text-sm">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <StatCardGrid columns={4}>
        <AnimatedStatCard title="Total" value={migration.totalApps} icon={Clock} color="cyan" delay={0} />
        <AnimatedStatCard title="Matched" value={matchedApps.length} icon={CheckCircle2} color="success" delay={0.1} />
        <AnimatedStatCard title="Partial" value={partialApps.length} icon={AlertTriangle} color="warning" delay={0.2} />
        <AnimatedStatCard title="Pending" value={pendingMatch.length + unmatchedApps.length} icon={Clock} color="violet" delay={0.3} />
      </StatCardGrid>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search apps..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-black/5 border border-black/10 rounded-lg text-text-primary placeholder-text-muted focus:border-accent-cyan focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'matched', 'partial', 'unmatched', 'pending'] as const).map(status => (
            <button
              key={status}
              onClick={() => setMatchStatusFilter(status)}
              className={cn(
                'px-3 py-2 rounded-lg text-sm font-medium transition-all',
                matchStatusFilter === status
                  ? 'bg-gradient-to-r from-accent-cyan to-accent-violet text-white'
                  : 'bg-black/5 text-text-secondary hover:text-text-primary hover:bg-black/10'
              )}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* App List Header */}
      <div className="flex items-center gap-4 py-2 px-4 bg-black/5 rounded-lg">
        <input
          type="checkbox"
          checked={selectedApps.size === apps.length && apps.length > 0}
          onChange={handleSelectAll}
          className="rounded border-black/20"
        />
        <span className="text-sm text-text-secondary">
          {selectedApps.size > 0 ? `${selectedApps.size} selected` : 'Select all'}
        </span>
      </div>

      {/* Apps List */}
      <div className="space-y-2">
        {apps.map(app => (
          <AppRow
            key={app.id}
            app={app}
            isSelected={selectedApps.has(app.id)}
            onSelect={() => handleSelectApp(app.id)}
          />
        ))}
      </div>

      {apps.length === 0 && (
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <p className="text-text-secondary">No apps found matching your criteria</p>
        </div>
      )}
    </div>
  );
}

function AppRow({
  app,
  isSelected,
  onSelect,
}: {
  app: SccmAppRow;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    matched: { label: 'Matched', color: 'text-status-success', bg: 'bg-status-success/10' },
    partial: { label: 'Partial', color: 'text-status-warning', bg: 'bg-status-warning/10' },
    unmatched: { label: 'Unmatched', color: 'text-text-secondary', bg: 'bg-zinc-500/10' },
    pending: { label: 'Pending', color: 'text-accent-violet', bg: 'bg-accent-violet/10' },
    excluded: { label: 'Excluded', color: 'text-text-muted', bg: 'bg-zinc-500/10' },
    manual: { label: 'Manual', color: 'text-accent-cyan', bg: 'bg-accent-cyan/10' },
  };

  const config = statusConfig[app.match_status] || statusConfig.pending;

  return (
    <div
      className={cn(
        'flex items-center gap-4 p-4 bg-black/2 border rounded-lg transition-all hover:bg-black/5',
        isSelected ? 'border-accent-cyan/50 bg-accent-cyan/5' : 'border-black/5'
      )}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onSelect}
        className="rounded border-black/20"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <h4 className="text-text-primary font-medium truncate">{app.display_name}</h4>
          <span className={cn('px-2 py-0.5 rounded text-xs font-medium', config.bg, config.color)}>
            {config.label}
            {app.match_confidence && app.match_status === 'matched' && (
              <span className="ml-1 opacity-70">{Math.round(app.match_confidence * 100)}%</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-4 mt-1 text-sm text-text-muted">
          {app.manufacturer && <span>{app.manufacturer}</span>}
          {app.version && <span>v{app.version}</span>}
          {app.technology && <span className="text-xs px-2 py-0.5 bg-black/5 rounded">{app.technology}</span>}
          {app.is_deployed && (
            <span className="text-accent-cyan text-xs">
              {app.deployment_count} deployments
            </span>
          )}
        </div>
      </div>

      {app.matched_winget_id && (
        <div className="flex items-center gap-2 text-sm">
          <Link2 className="w-4 h-4 text-text-muted" />
          <span className="text-accent-cyan">{app.matched_winget_id}</span>
        </div>
      )}
    </div>
  );
}
