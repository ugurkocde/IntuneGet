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
  ChevronsUpDown,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

function getFilterContextText(filters: UnmanagedAppsFilters): string {
  const parts: string[] = [];
  if (filters.matchStatus !== 'all') {
    const labels: Record<string, string> = {
      matched: 'Matched',
      partial: 'Partial',
      unmatched: 'Unmatched',
    };
    parts.push(labels[filters.matchStatus] || filters.matchStatus);
  }
  if (!filters.showClaimed) {
    parts.push('unclaimed only');
  }
  if (filters.search) {
    parts.push(`"${filters.search}"`);
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

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

  const currentSortLabel = sortOptions.find(o => o.value === filters.sortBy)?.label || 'Sort';

  return (
    <div className="glass-light rounded-xl p-4 border border-overlay/5 space-y-3">
      {/* Row 1: Search | Claim All | Sort | View Toggle */}
      <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
        {/* Search */}
        <div className="relative flex-1 w-full lg:w-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <Input
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search by app name, publisher, or package ID..."
            className="pl-10 bg-bg-elevated border-overlay/10 text-text-primary placeholder:text-text-muted focus:border-accent-cyan/50 focus:ring-accent-cyan/20"
          />
          {localSearch && (
            <button
              type="button"
              aria-label="Clear search"
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
            type="button"
            onClick={onClaimAll}
            disabled={claimableCount === 0 || isClaimAllDisabled}
            className={cn(
              'h-9 px-4 border-0 transition-all',
              claimableCount > 0
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white'
                : 'bg-overlay/5 text-text-muted cursor-not-allowed'
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

          {/* Sort - Desktop: inline buttons */}
          <div className="hidden md:flex items-center gap-1">
            <span className="text-sm text-text-muted">Sort:</span>
            {sortOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleSortChange(option.value)}
                aria-sort={filters.sortBy === option.value ? (filters.sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                className={cn(
                  'text-sm transition-colors',
                  filters.sortBy === option.value
                    ? 'text-accent-cyan bg-accent-cyan/10'
                    : 'text-text-secondary hover:text-text-primary hover:bg-overlay/5'
                )}
              >
                {option.label}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Sort ${filters.sortOrder === 'asc' ? 'ascending' : 'descending'}, click to toggle`}
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  sortOrder: filters.sortOrder === 'desc' ? 'asc' : 'desc',
                })
              }
              className="text-text-secondary hover:text-text-primary hover:bg-overlay/5"
            >
              {filters.sortOrder === 'asc' ? (
                <SortAsc className="w-4 h-4" />
              ) : (
                <SortDesc className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* Sort - Mobile: dropdown */}
          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-text-secondary hover:text-text-primary"
                >
                  <ChevronsUpDown className="w-4 h-4 mr-1.5" />
                  {currentSortLabel}
                  {filters.sortOrder === 'asc' ? (
                    <SortAsc className="w-3.5 h-3.5 ml-1" />
                  ) : (
                    <SortDesc className="w-3.5 h-3.5 ml-1" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {sortOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => handleSortChange(option.value)}
                    className="flex items-center justify-between"
                  >
                    {option.label}
                    {filters.sortBy === option.value && (
                      <Check className="w-4 h-4 text-accent-cyan ml-2" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onClick={() =>
                    onFiltersChange({
                      ...filters,
                      sortOrder: filters.sortOrder === 'desc' ? 'asc' : 'desc',
                    })
                  }
                >
                  {filters.sortOrder === 'asc' ? 'Sort Descending' : 'Sort Ascending'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-0.5 border border-overlay/5 rounded-lg p-0.5" role="group" aria-label="View mode">
            <button
              type="button"
              onClick={() => onViewModeChange('grid')}
              aria-pressed={viewMode === 'grid'}
              aria-label="Grid view"
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'grid'
                  ? 'bg-accent-cyan/10 text-accent-cyan'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('list')}
              aria-pressed={viewMode === 'list'}
              aria-label="List view"
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'list'
                  ? 'bg-accent-cyan/10 text-accent-cyan'
                  : 'text-text-muted hover:text-text-primary'
              )}
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

        <div className="h-6 w-px bg-overlay/10 mx-1" />

        <FilterChip
          active={!filters.showClaimed}
          onClick={() => onFiltersChange({ ...filters, showClaimed: !filters.showClaimed })}
          color="#8b5cf6"
        >
          {filters.showClaimed ? 'Showing Claimed' : 'Hiding Claimed'}
        </FilterChip>

        <div className="ml-auto text-sm text-text-muted">
          Showing <span className="text-text-primary font-medium">{filteredCount}</span> of{' '}
          <span className="text-text-primary font-medium">{totalCount}</span>
          <span className="hidden sm:inline">{getFilterContextText(filters)}</span>
        </div>
      </div>
    </div>
  );
}
