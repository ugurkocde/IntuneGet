import { SkeletonGrid } from '@/components/dashboard';

export default function InventoryLoading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-8 w-32 bg-overlay/5 rounded animate-pulse mb-2" />
        <div className="h-4 w-80 bg-overlay/5 rounded animate-pulse" />
      </div>

      {/* Stats skeleton */}
      <SkeletonGrid count={4} columns={4} variant="stat" />

      {/* Filters skeleton */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="h-10 w-64 bg-overlay/5 rounded-lg animate-pulse" />
          <div className="h-10 w-32 bg-overlay/5 rounded-lg animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-24 bg-overlay/5 rounded animate-pulse" />
        </div>
      </div>

      {/* Apps grid skeleton */}
      <SkeletonGrid count={6} columns={3} variant="content" />
    </div>
  );
}
