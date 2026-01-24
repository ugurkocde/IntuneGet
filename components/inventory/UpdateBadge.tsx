'use client';

import { useAppUpdates } from '@/hooks/use-updates';

export function UpdateBadge() {
  const { data, isLoading, isError } = useAppUpdates();

  // Don't show badge while loading, on error, or when there are no updates
  if (isLoading || isError || !data || data.updateCount === 0) {
    return null;
  }

  return (
    <span className="ml-auto inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full bg-orange-500/10 text-orange-500">
      {data.updateCount}
    </span>
  );
}
