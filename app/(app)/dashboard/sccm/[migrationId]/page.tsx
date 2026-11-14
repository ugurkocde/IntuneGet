'use client';

import { useState, useEffect, useCallback, useRef, useMemo, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  Wand2,
  ArrowRight,
  Link2,
  AlertTriangle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Ban,
} from 'lucide-react';
import { toast } from 'sonner';
import { T } from 'gt-next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader, AnimatedStatCard, StatCardGrid, SkeletonGrid } from '@/components/dashboard';
import { SccmManualMatchModal, SccmMigrationStepper } from '@/components/sccm';
import type { SccmMigration, SccmMatchStatus, SccmAppRecord, SccmMatchProgress } from '@/types/sccm';

const PAGE_SIZE = 100;

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'status', label: 'Status' },
  { value: 'confidence', label: 'Confidence' },
  { value: 'deployments', label: 'Deployments' },
] as const;

type SortField = (typeof SORT_OPTIONS)[number]['value'];

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

function toAppRecord(row: SccmAppRow): SccmAppRecord {
  return {
    id: row.id,
    migrationId: row.migration_id,
    userId: '',
    tenantId: '',
    sccmCiId: row.sccm_ci_id,
    displayName: row.display_name,
    manufacturer: row.manufacturer,
    version: row.version,
    technology: row.technology as SccmAppRecord['technology'],
    isDeployed: row.is_deployed,
    deploymentCount: row.deployment_count,
    sccmAppData: {} as SccmAppRecord['sccmAppData'],
    sccmDetectionRules: [],
    sccmInstallCommand: null,
    sccmUninstallCommand: null,
    sccmInstallBehavior: null,
    matchStatus: row.match_status as SccmAppRecord['matchStatus'],
    matchConfidence: row.match_confidence,
    matchedWingetId: row.matched_winget_id,
    matchedWingetName: row.matched_winget_name,
    partialMatches: (row.partial_matches || []) as SccmAppRecord['partialMatches'],
    preserveDetectionRules: true,
    preserveInstallCommands: false,
    useWingetDefaults: true,
    migrationStatus: 'pending',
    createdAt: '',
    updatedAt: '',
  };
}

export default function MigrationDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { getAccessToken } = useMicrosoftAuth();

  const [migration, setMigration] = useState<SccmMigration | null>(null);
  const [apps, setApps] = useState<SccmAppRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState<SccmMatchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [matchStatusFilter, setMatchStatusFilter] = useState<SccmMatchStatus | 'all'>('all');
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [manualMatchApp, setManualMatchApp] = useState<SccmAppRow | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sortBy,
        sortDir,
      });

      if (debouncedSearch) params.set('search', debouncedSearch);
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
  }, [getAccessToken, resolvedParams.migrationId, debouncedSearch, matchStatusFilter, offset, sortBy, sortDir]);

  useEffect(() => {
    fetchMigration();
    fetchApps();
  }, [fetchMigration, fetchApps]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, matchStatusFilter, sortBy, sortDir]);

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const handleRunMatching = async () => {
    setIsMatching(true);
    setMatchProgress(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Authentication required');

      toast.info('Matching started...');

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

      // Start polling for progress
      pollIntervalRef.current = setInterval(async () => {
        try {
          const token = await getAccessToken();
          if (!token) return;

          const progressRes = await fetch(
            `/api/sccm/migrations?id=${resolvedParams.migrationId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );

          if (progressRes.ok) {
            const progressData = await progressRes.json();
            const mig = progressData.migration;

            if (mig && mig.status !== 'matching') {
              // Matching complete
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
              setIsMatching(false);
              setMatchProgress(null);
              toast.success(`Matching complete: ${mig.matchedApps} matched, ${mig.partialMatchApps} partial`);
              await fetchMigration();
              await fetchApps();
            } else if (mig) {
              setMatchProgress({
                migrationId: mig.id,
                total: mig.totalApps,
                processed: mig.matchedApps + mig.partialMatchApps + mig.unmatchedApps,
                matched: mig.matchedApps,
                partial: mig.partialMatchApps,
                unmatched: mig.unmatchedApps,
                isComplete: false,
              });
            }
          }
        } catch {
          // Silently continue polling
        }
      }, 2000);
    } catch (err) {
      setIsMatching(false);
      const message = err instanceof Error ? err.message : 'Matching failed';
      setError(message);
      toast.error(message);
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
    const ids = Array.from(selectedApps);

    if (ids.length > 50) {
      // Store in sessionStorage to avoid URL length limits
      sessionStorage.setItem(
        `sccm-migrate-${resolvedParams.migrationId}`,
        JSON.stringify(ids)
      );
      router.push(`/dashboard/sccm/${resolvedParams.migrationId}/migrate?source=session`);
    } else {
      router.push(`/dashboard/sccm/${resolvedParams.migrationId}/migrate?apps=${ids.join(',')}`);
    }
  };

  const handleManualLink = async (appId: string, wingetPackageId: string, wingetPackageName: string) => {
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error('Authentication required');

    const response = await fetch('/api/sccm/match', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        appId,
        action: 'link',
        wingetPackageId,
        wingetPackageName,
      }),
    });

    if (!response.ok) throw new Error('Failed to link package');

    toast.success('Package linked successfully');
    await fetchApps();
    await fetchMigration();
  };

  const handleExcludeApp = async (appId: string) => {
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error('Authentication required');

    const response = await fetch('/api/sccm/match', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        appId,
        action: 'exclude',
      }),
    });

    if (!response.ok) throw new Error('Failed to exclude app');

    toast.success('App excluded');
    await fetchApps();
    await fetchMigration();
  };

  const handleBulkExclude = async () => {
    if (selectedApps.size === 0) return;

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Authentication required');

      const ids = Array.from(selectedApps);
      await Promise.all(
        ids.map(appId =>
          fetch('/api/sccm/match', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ appId, action: 'exclude' }),
          })
        )
      );

      toast.success(`Excluded ${ids.length} apps`);
      setSelectedApps(new Set());
      await fetchApps();
      await fetchMigration();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to exclude apps');
    }
  };

  const handleSortToggle = (field: SortField) => {
    if (sortBy === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-overlay/5 rounded animate-pulse" />
        <SkeletonGrid count={4} columns={4} variant="stat" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-20 bg-overlay/5 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!migration) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-status-error mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-text-primary mb-2"><T>Migration Not Found</T></h2>
        <Link href="/dashboard/sccm">
          <Button variant="outline"><T>Back to Migrations</T></Button>
        </Link>
      </div>
    );
  }

  const matchedApps = apps.filter(a => a.match_status === 'matched');
  const partialApps = apps.filter(a => a.match_status === 'partial');
  const unmatchedApps = apps.filter(a => a.match_status === 'unmatched');
  const pendingMatch = apps.filter(a => a.match_status === 'pending');
  const isFiltered = debouncedSearch || matchStatusFilter !== 'all';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/sccm">
          <Button variant="ghost" size="sm" className="text-text-secondary hover:text-text-primary">
            <ArrowLeft className="w-4 h-4 mr-2" />
            <T>Back</T>
          </Button>
        </Link>
      </div>

      <SccmMigrationStepper currentStep={2} migrationId={resolvedParams.migrationId} />

      <PageHeader
        title={migration.name}
        description={migration.description || <T>{migration.totalApps} applications from SCCM</T>}
        gradient
        gradientColors="cyan"
        actions={
          <div className="flex items-center gap-3">
            <Button
              onClick={() => fetchApps(true)}
              disabled={isRefreshing}
              variant="outline"
              className="border-overlay/10 text-text-secondary"
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
              <T>Run Matching</T>
            </Button>
            <Button
              onClick={handleMigrateSelected}
              disabled={selectedApps.size === 0}
              className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90"
            >
              <T>Migrate ({selectedApps.size})</T>
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        }
      />

      {/* Match Progress Banner */}
      <AnimatePresence>
        {isMatching && matchProgress && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-accent-cyan/10 border border-accent-cyan/20 rounded-lg"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-accent-cyan animate-spin" />
                <span className="text-accent-cyan text-sm font-medium">
                  <T>Matching in progress...</T>
                </span>
              </div>
              <span className="text-text-secondary text-sm">
                {matchProgress.processed} / {matchProgress.total}
              </span>
            </div>
            <div className="h-2 bg-overlay/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-cyan to-accent-violet transition-all duration-500"
                style={{ width: `${matchProgress.total > 0 ? (matchProgress.processed / matchProgress.total) * 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
              <span className="text-status-success"><T>{matchProgress.matched} matched</T></span>
              <span className="text-status-warning"><T>{matchProgress.partial} partial</T></span>
              <span><T>{matchProgress.unmatched} unmatched</T></span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
            <div className="flex-1">
              <p className="text-status-error text-sm">{error}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setError(null); fetchApps(); }}
              className="text-status-error hover:bg-status-error/10 text-xs"
            >
              <T>Retry</T>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <StatCardGrid columns={4}>
        <AnimatedStatCard title={<T>Total</T>} value={migration.totalApps} icon={Clock} color="cyan" delay={0} />
        <AnimatedStatCard title={<T>Matched</T>} value={matchedApps.length} icon={CheckCircle2} color="success" delay={0.1} />
        <AnimatedStatCard title={<T>Partial</T>} value={partialApps.length} icon={AlertTriangle} color="warning" delay={0.2} />
        <AnimatedStatCard title={<T>Pending</T>} value={pendingMatch.length + unmatchedApps.length} icon={Clock} color="violet" delay={0.3} />
      </StatCardGrid>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search apps..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-overlay/5 border border-overlay/10 rounded-lg text-text-primary placeholder-text-muted focus:border-accent-cyan focus:outline-none"
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
                  : 'bg-overlay/5 text-text-secondary hover:text-text-primary hover:bg-overlay/10'
              )}
            >
              <T>{status.charAt(0).toUpperCase() + status.slice(1)}</T>
            </button>
          ))}
        </div>
      </div>

      {/* Sort Controls */}
      <div className="flex items-center gap-2">
        <ArrowUpDown className="w-4 h-4 text-text-muted" />
        <span className="text-xs text-text-muted mr-1"><T>Sort by:</T></span>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => handleSortToggle(opt.value)}
            className={cn(
              'px-2 py-1 rounded text-xs font-medium transition-all',
              sortBy === opt.value
                ? 'bg-accent-cyan/10 text-accent-cyan'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            <T>{opt.label}</T>
            {sortBy === opt.value && (
              <span className="ml-0.5">{sortDir === 'asc' ? ' ^' : ' v'}</span>
            )}
          </button>
        ))}
      </div>

      {/* App List Header */}
      <div className="flex items-center gap-4 py-2 px-4 bg-overlay/5 rounded-lg">
        <input
          type="checkbox"
          checked={selectedApps.size === apps.length && apps.length > 0}
          onChange={handleSelectAll}
          className="rounded border-black/20"
        />
        <span className="text-sm text-text-secondary">
          {selectedApps.size > 0
            ? <T>{selectedApps.size} selected</T>
            : isFiltered
              ? <T>Select all {apps.length} filtered</T>
              : <T>Select all</T>}
        </span>
        <span className="ml-auto text-xs text-text-muted">
          <T>Showing {offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total}</T>
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
            onManualMatch={() => setManualMatchApp(app)}
            onExclude={() => handleExcludeApp(app.id)}
          />
        ))}
      </div>

      {/* Empty / No results */}
      {apps.length === 0 && (
        <div className="text-center py-12">
          <Search className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <p className="text-text-secondary"><T>No apps found matching your criteria</T></p>
          {isFiltered && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4 border-overlay/10 text-text-secondary"
              onClick={() => {
                setSearchInput('');
                setMatchStatusFilter('all');
              }}
            >
              <T>Clear Filters</T>
            </Button>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(prev => Math.max(0, prev - PAGE_SIZE))}
            className="border-overlay/10 text-text-secondary"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            <T>Previous</T>
          </Button>
          <span className="text-sm text-text-muted">
            <T>Page {currentPage} of {totalPages}</T>
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(prev => prev + PAGE_SIZE)}
            className="border-overlay/10 text-text-secondary"
          >
            <T>Next</T>
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Bulk Operations Bar */}
      <AnimatePresence>
        {selectedApps.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-0 left-0 right-0 p-4 bg-bg-elevated/95 backdrop-blur border-t border-overlay/10 z-40"
          >
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <span className="text-sm text-text-secondary">
                <T>{selectedApps.size} app{selectedApps.size !== 1 ? 's' : ''} selected</T>
              </span>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedApps(new Set())}
                  className="text-text-muted"
                >
                  <T>Clear</T>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkExclude}
                  className="border-overlay/10 text-text-secondary hover:text-status-error hover:border-status-error/30"
                >
                  <Ban className="w-4 h-4 mr-2" />
                  <T>Exclude Selected</T>
                </Button>
                <Button
                  size="sm"
                  onClick={handleMigrateSelected}
                  className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90"
                >
                  <T>Migrate ({selectedApps.size})</T>
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual Match Modal */}
      <SccmManualMatchModal
        app={manualMatchApp ? toAppRecord(manualMatchApp) : null}
        isOpen={!!manualMatchApp}
        onClose={() => setManualMatchApp(null)}
        onLink={handleManualLink}
        onExclude={handleExcludeApp}
      />
    </div>
  );
}

function AppRow({
  app,
  isSelected,
  onSelect,
  onManualMatch,
  onExclude,
}: {
  app: SccmAppRow;
  isSelected: boolean;
  onSelect: () => void;
  onManualMatch: () => void;
  onExclude: () => void;
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
  const showLinkButton = ['unmatched', 'partial', 'pending'].includes(app.match_status);

  const confidenceColor = app.match_confidence !== null
    ? app.match_confidence >= 0.8
      ? 'text-status-success'
      : app.match_confidence >= 0.5
        ? 'text-status-warning'
        : 'text-status-error'
    : '';

  return (
    <div
      className={cn(
        'flex items-center gap-4 p-4 bg-black/2 border rounded-lg transition-all hover:bg-overlay/5',
        isSelected ? 'border-accent-cyan/50 bg-accent-cyan/5' : 'border-overlay/5'
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
            <T>{config.label}</T>
          </span>
          {app.match_confidence !== null && app.match_status === 'matched' && (
            <span className={cn('text-xs font-medium', confidenceColor)}>
              {Math.round(app.match_confidence * 100)}%
            </span>
          )}
        </div>

        {app.matched_winget_id && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <Link2 className="w-3 h-3 text-text-muted" />
            <span className="text-accent-cyan text-sm">{app.matched_winget_id}</span>
          </div>
        )}

        <div className="flex items-center gap-4 mt-1 text-sm text-text-muted">
          {app.manufacturer && <span>{app.manufacturer}</span>}
          {app.version && <span>v{app.version}</span>}
          {app.technology && <span className="text-xs px-2 py-0.5 bg-overlay/5 rounded">{app.technology}</span>}
          {app.is_deployed && (
            <span className="text-accent-cyan text-xs">
              <T>{app.deployment_count} deployments</T>
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {showLinkButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onManualMatch}
            className="text-text-muted hover:text-accent-cyan hover:bg-accent-cyan/10 text-xs"
          >
            <Link2 className="w-3.5 h-3.5 mr-1" />
            <T>Link</T>
          </Button>
        )}
        {app.match_status !== 'excluded' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onExclude}
            className="text-text-muted hover:text-status-error hover:bg-status-error/10 text-xs"
          >
            <Ban className="w-3.5 h-3.5 mr-1" />
            <T>Exclude</T>
          </Button>
        )}
      </div>
    </div>
  );
}
