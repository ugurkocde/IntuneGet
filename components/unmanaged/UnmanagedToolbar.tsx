'use client';

import { useState, useEffect } from 'react';
import {
  Search,
  X,
  LayoutGrid,
  Rows3,
  SortAsc,
  SortDesc,
  ShoppingCart,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterChip } from './FilterChip';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import type { UnmanagedAppsFilters, MatchStatus } from '@/types/unmanaged';

type ViewMode = 'grid' | 'list';

interface UnmanagedToolbarProps {
  filters: UnmanagedAppsFilters;
  onFiltersChange: (filters: UnmanagedAppsFilters) => void;
  statusCounts: { all: number; matched: number; partial: number; unmatched: number };
  claimableCount: number;
  filteredCount: number;
  totalCount: number;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onClaimAll: () => void;
  isClaimAllDisabled: boolean;
}

const sortOptions = [
  { value: 'name' as const, label: 'Name' },
  { value: 'deviceCount' as const, label: 'Devices' },
  { value: 'publisher' as const, label: 'Publisher' },
  { value: 'matchStatus' as const, label: 'Status' },
];

const SEARCH_DEBOUNCE_MS = 300;

export function UnmanagedToolbar({
  filters,
  onFiltersChange,
  statusCounts,
  claimableCount,
  filteredCount,
  totalCount,
  viewMode,
  onViewModeChange,
  onClaimAll,
  isClaimAllDisabled,
}: UnmanagedToolbarProps) {
  const [localSearch, setLocalSearch] = useState(filters.search);
  const debouncedSearch = useDebounce(localSearch, SEARCH_DEBOUNCE_MS);

  // Sync local state when external search changes (e.g., clear filters)
  useEffect(() => {
    if (filters.search !== localSearch) {
      setLocalSearch(filters.search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  // Notify parent when debounced value changes
  useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onFiltersChange({ ...filters, search: debouncedSearch });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const handleSortChange = (sortBy: UnmanagedAppsFilters['sortBy']) => {
    if (filters.sortBy === sortBy) {
      onFiltersChange({ ...filters, sortOrder: filters.sortOrder === 'desc' ? 'asc' : 'desc' });
    } else {
      onFiltersChange({ ...filters, sortBy });
    }
  };

  const handleMatchStatusChange = (status: MatchStatus | 'all') => {
    onFiltersChange({ ...filters, matchStatus: status });
  };

  return (
    <div className="glass-light rounded-xl p-4 border border-black/5 space-y-3">
      {/* Row 1: Search | Claim All | Sort | View Toggle */}
      <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
        {/* Search */}
        <div className="relative flex-1 w-full lg:w-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <Input
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search by app name, publisher, or package ID..."
            className="pl-10 bg-bg-elevated border-black/10 text-text-primary placeholder:text-text-muted focus:border-accent-cyan/50 focus:ring-accent-cyan/20"
          />
          {localSearch && (
            <button
              onClick={() => {
                setLocalSearch('');
                onFiltersChange({ ...filters, search: '' });
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Claim All */}
          <Button
            onClick={onClaimAll}
            disabled={claimableCount === 0 || isClaimAllDisabled}
            className={cn(
              'h-9 px-4 border-0 transition-all',
              claimableCount > 0
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white'
                : 'bg-black/5 text-text-muted cursor-not-allowed'
            )}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            Claim All
            {claimableCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-white/20 text-xs tabular-nums">
                {claimableCount}
              </span>
            )}
          </Button>

          {/* Sort buttons */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-sm text-text-muted">Sort:</span>
            {sortOptions.map((option) => (
              <Button
                key={option.value}
                variant="ghost"
                size="sm"
                onClick={() => handleSortChange(option.value)}
                className={cn(
                  'text-sm transition-colors',
                  filters.sortBy === option.value
                    ? 'text-accent-cyan bg-accent-cyan/10'
                    : 'text-text-secondary hover:text-text-primary hover:bg-black/5'
                )}
              >
                {option.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  sortOrder: filters.sortOrder === 'desc' ? 'asc' : 'desc',
                })
              }
              className="text-text-secondary hover:text-text-primary hover:bg-black/5"
            >
              {filters.sortOrder === 'asc' ? (
                <SortAsc className="w-4 h-4" />
              ) : (
                <SortDesc className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-0.5 border border-black/5 rounded-lg p-0.5">
            <button
              onClick={() => onViewModeChange('grid')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'grid'
                  ? 'bg-accent-cyan/10 text-accent-cyan'
                  : 'text-text-muted hover:text-text-primary'
              )}
              aria-label="Grid view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => onViewModeChange('list')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'list'
                  ? 'bg-accent-cyan/10 text-accent-cyan'
                  : 'text-text-muted hover:text-text-primary'
              )}
              aria-label="List view"
            >
              <Rows3 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Row 2: Filter chips | Hide Claimed | Count */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          active={filters.matchStatus === 'all'}
          onClick={() => handleMatchStatusChange('all')}
          count={statusCounts.all}
          color="#06b6d4"
        >
          All
        </FilterChip>
        <FilterChip
          active={filters.matchStatus === 'matched'}
          onClick={() => handleMatchStatusChange('matched')}
          count={statusCounts.matched}
          color="#10b981"
          icon={CheckCircle2}
        >
          Matched
        </FilterChip>
        <FilterChip
          active={filters.matchStatus === 'partial'}
          onClick={() => handleMatchStatusChange('partial')}
          count={statusCounts.partial}
          color="#f59e0b"
          icon={AlertCircle}
        >
          Partial
        </FilterChip>
        <FilterChip
          active={filters.matchStatus === 'unmatched'}
          onClick={() => handleMatchStatusChange('unmatched')}
          count={statusCounts.unmatched}
          color="#71717a"
          icon={HelpCircle}
        >
          Unmatched
        </FilterChip>

        <div className="h-6 w-px bg-black/10 mx-1" />

        <FilterChip
          active={!filters.showClaimed}
          onClick={() => onFiltersChange({ ...filters, showClaimed: !filters.showClaimed })}
          color="#8b5cf6"
        >
          {filters.showClaimed ? 'Hide Claimed' : 'Show Claimed'}
        </FilterChip>

        <div className="ml-auto text-sm text-text-muted">
          Showing <span className="text-text-primary font-medium">{filteredCount}</span> of{' '}
          <span className="text-text-primary font-medium">{totalCount}</span>
        </div>
      </div>
    </div>
  );
}
