'use client';

import { useState, useEffect } from 'react';
import { Search, SortAsc, SortDesc } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/use-debounce';
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
}: InventoryFiltersProps) {
  // Local state for immediate input feedback
  const [localSearch, setLocalSearch] = useState(search);

  // Debounce the search value
  const debouncedSearch = useDebounce(localSearch, SEARCH_DEBOUNCE_MS);

  // Sync local state when external search changes (e.g., reset)
  useEffect(() => {
    if (search !== localSearch) {
      setLocalSearch(search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Notify parent when debounced value changes
  useEffect(() => {
    if (debouncedSearch !== search) {
      onSearchChange(debouncedSearch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
      {/* Search */}
      <div className="relative w-full sm:w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <Input
          type="text"
          placeholder="Search apps..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          className="pl-10 bg-bg-surface border-white/10 text-white placeholder:text-zinc-500 focus:border-accent-cyan/50 focus:ring-accent-cyan/20"
        />
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">
          {filteredCount} of {totalCount} apps
        </span>
        <div className="flex items-center gap-1 ml-4">
          <span className="text-sm text-zinc-500">Sort:</span>
          {sortOptions.map((option) => (
            <Button
              key={option.value}
              variant="ghost"
              size="sm"
              onClick={() => onSortChange(option.value)}
              className={cn(
                'text-sm transition-colors',
                sortBy === option.value
                  ? 'text-accent-cyan bg-accent-cyan/10'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              )}
            >
              {option.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={onSortOrderToggle}
            className="text-zinc-400 hover:text-white hover:bg-white/5"
          >
            {sortOrder === 'asc' ? (
              <SortAsc className="w-4 h-4" />
            ) : (
              <SortDesc className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
