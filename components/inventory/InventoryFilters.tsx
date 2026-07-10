'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, SortAsc, SortDesc, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import { PublisherFilter } from './PublisherFilter';
import { cn } from '@/lib/utils';

interface InventoryFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  sortBy: 'name' | 'publisher' | 'created' | 'modified';
  sortOrder: 'asc' | 'desc';
  onSortChange: (sortBy: 'name' | 'publisher' | 'created' | 'modified') => void;
  onSortOrderToggle: () => void;
  totalCount: number;
  filteredCount: number;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  publishers: string[];
  selectedPublisher: string | null;
  onPublisherChange: (publisher: string | null) => void;
}

const sortOptions = [
  { value: 'name', label: 'Name' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'created', label: 'Created' },
  { value: 'modified', label: 'Modified' },
] as const;

const SEARCH_DEBOUNCE_MS = 300;

export function InventoryFilters({
  search,
  onSearchChange,
  sortBy,
  sortOrder,
  onSortChange,
  onSortOrderToggle,
  totalCount,
  filteredCount,
  viewMode,
  onViewModeChange,
  publishers,
  selectedPublisher,
  onPublisherChange,
}: InventoryFiltersProps) {
  // Local state for immediate input feedback
  const [localSearch, setLocalSearch] = useState(search);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce the search value
  const debouncedSearch = useDebounce(localSearch, SEARCH_DEBOUNCE_MS);

  // Sync local state when external search changes (e.g., reset)
  useEffect(() => {
    if (search !== localSearch) {
      setLocalSearch(search);
    }
  }, [search]);

  // Notify parent when debounced value changes
  useEffect(() => {
    if (debouncedSearch !== search) {
      onSearchChange(debouncedSearch);
    }
  }, [debouncedSearch]);

  // "/" keyboard shortcut to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="glass-light rounded-xl p-4 border border-overlay/5">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Search + Publisher Filter */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search apps... (press / to focus)"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="pl-10 bg-bg-elevated border-overlay/10 text-text-primary placeholder:text-text-muted focus:border-accent-cyan/50 focus:ring-accent-cyan/20"
            />
          </div>
          <PublisherFilter
            publishers={publishers}
            selectedPublisher={selectedPublisher}
            onPublisherChange={onPublisherChange}
          />
        </div>

        {/* Sort controls + View toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-text-muted">
            {filteredCount} of {totalCount} apps
          </span>
          <div className="flex flex-wrap items-center gap-1 sm:ml-4">
            <span className="text-sm text-text-muted">Sort:</span>
            {sortOptions.map((option) => (
              <Button
                key={option.value}
                variant="ghost"
                size="sm"
                onClick={() => onSortChange(option.value)}
                aria-pressed={sortBy === option.value}
                className={cn(
                  'text-sm transition-colors',
                  sortBy === option.value
                    ? 'text-accent-cyan bg-accent-cyan/10'
                    : 'text-text-secondary hover:text-text-primary hover:bg-overlay/5'
                )}
              >
                {option.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={onSortOrderToggle}
              aria-label={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
              className="text-text-secondary hover:text-text-primary hover:bg-overlay/5"
            >
              {sortOrder === 'asc' ? (
                <SortAsc className="w-4 h-4" />
              ) : (
                <SortDesc className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-0.5 ml-2 border border-overlay/5 rounded-lg p-0.5" role="group" aria-label="View mode">
            <button
              onClick={() => onViewModeChange('grid')}
              aria-pressed={viewMode === 'grid'}
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
              aria-pressed={viewMode === 'list'}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'list'
                  ? 'bg-accent-cyan/10 text-accent-cyan'
                  : 'text-text-muted hover:text-text-primary'
              )}
              aria-label="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
