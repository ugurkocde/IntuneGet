'use client';

import Link from 'next/link';
import {
  Radar,
  Package,
  Search,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
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
    getDescription: () => 'Every matched app has been claimed and added to your deployment cart. Head to Deployments to continue.',
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
  const isSuccess = variant === 'all-claimed';

  return (
    <div className="text-center py-20 relative">
      {/* Background accent for success variant */}
      {isSuccess && (
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 via-transparent to-transparent rounded-2xl" />
      )}

      <div className="relative">
        <div className="relative w-20 h-20 mx-auto mb-6">
          <div
            className={`absolute inset-0 rounded-2xl flex items-center justify-center ${
              isSuccess
                ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-600/10'
                : 'bg-gradient-to-br from-black/5 to-black/10'
            }`}
          >
            <Icon
              className={`w-10 h-10 ${
                isSuccess ? 'text-emerald-400' : 'text-text-muted'
              }`}
            />
          </div>
          {isSuccess && (
            <div className="absolute -inset-2 rounded-2xl bg-emerald-500/10 blur-xl opacity-60" />
          )}
        </div>
        <h3
          className={`text-xl font-semibold mb-2 ${
            isSuccess ? 'text-emerald-400' : 'text-text-primary'
          }`}
        >
          {title}
        </h3>
        <p className="text-text-secondary max-w-md mx-auto">
          {getDescription(searchTerm)}
        </p>

        <div className="flex items-center justify-center gap-3 mt-6">
          {variant === 'no-data' && onRefresh && (
            <Button type="button" variant="outline" onClick={onRefresh} className="border-overlay/10">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          )}
          {variant === 'filtered' && onClearFilters && (
            <Button type="button" variant="outline" onClick={onClearFilters} className="border-overlay/10">
              Clear Filters
            </Button>
          )}
          {variant === 'search' && onClearSearch && (
            <Button type="button" variant="outline" onClick={onClearSearch} className="border-overlay/10">
              Clear Search
            </Button>
          )}
          {variant === 'all-claimed' && (
            <>
              {onViewAll && (
                <Button type="button" variant="outline" onClick={onViewAll} className="border-overlay/10">
                  View All Apps
                </Button>
              )}
              <Button asChild className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white border-0">
                <Link href="/dashboard/uploads">
                  Go to Deployments
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
