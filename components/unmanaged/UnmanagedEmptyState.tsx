'use client';

import {
  Radar,
  Package,
  Search,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type EmptyVariant = 'no-data' | 'filtered' | 'search' | 'all-claimed';

interface UnmanagedEmptyStateProps {
  variant: EmptyVariant;
  searchTerm?: string;
  onClearFilters?: () => void;
  onClearSearch?: () => void;
  onRefresh?: () => void;
  onViewAll?: () => void;
}

const config: Record<EmptyVariant, {
  icon: typeof Radar;
  title: string;
  getDescription: (searchTerm?: string) => string;
}> = {
  'no-data': {
    icon: Radar,
    title: 'No unmanaged apps discovered',
    getDescription: () => 'No unmanaged apps were found in your Intune tenant. Try refreshing to scan again.',
  },
  'filtered': {
    icon: Package,
    title: 'No apps match your filters',
    getDescription: () => 'Try adjusting your filter criteria to see more results.',
  },
  'search': {
    icon: Search,
    title: 'No results found',
    getDescription: (term) => `No apps match "${term || ''}". Try a different search term.`,
  },
  'all-claimed': {
    icon: CheckCircle2,
    title: 'All matched apps claimed!',
    getDescription: () => 'Every matched app has been claimed and added to your cart.',
  },
};

export function UnmanagedEmptyState({
  variant,
  searchTerm,
  onClearFilters,
  onClearSearch,
  onRefresh,
  onViewAll,
}: UnmanagedEmptyStateProps) {
  const { icon: Icon, title, getDescription } = config[variant];

  return (
    <div className="text-center py-20">
      <div className="relative w-20 h-20 mx-auto mb-6">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-black/5 to-black/10 flex items-center justify-center">
          <Icon className="w-10 h-10 text-text-muted" />
        </div>
      </div>
      <h3 className="text-xl font-semibold text-text-primary mb-2">{title}</h3>
      <p className="text-text-secondary max-w-md mx-auto">
        {getDescription(searchTerm)}
      </p>

      <div className="flex items-center justify-center gap-3 mt-6">
        {variant === 'no-data' && onRefresh && (
          <Button variant="outline" onClick={onRefresh} className="border-black/10">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        )}
        {variant === 'filtered' && onClearFilters && (
          <Button variant="outline" onClick={onClearFilters} className="border-black/10">
            Clear Filters
          </Button>
        )}
        {variant === 'search' && onClearSearch && (
          <Button variant="outline" onClick={onClearSearch} className="border-black/10">
            Clear Search
          </Button>
        )}
        {variant === 'all-claimed' && onViewAll && (
          <Button variant="outline" onClick={onViewAll} className="border-black/10">
            View All Apps
          </Button>
        )}
      </div>
    </div>
  );
}
