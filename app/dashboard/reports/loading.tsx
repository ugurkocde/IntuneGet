import { SkeletonGrid } from '@/components/dashboard';

export default function ReportsLoading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-8 w-48 bg-black/5 rounded animate-pulse mb-2" />
        <div className="h-4 w-72 bg-black/5 rounded animate-pulse" />
      </div>

      {/* Date range picker skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-16 bg-black/5 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-4 w-40 bg-black/5 rounded animate-pulse" />
      </div>

      {/* Stats grid skeleton */}
      <SkeletonGrid count={4} columns={4} variant="stat" />

      {/* Charts grid skeleton */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass-light rounded-xl p-6 border border-black/5">
          <div className="h-5 w-32 bg-black/5 rounded animate-pulse mb-4" />
          <div className="h-48 bg-black/5 rounded animate-pulse" />
        </div>
        <div className="glass-light rounded-xl p-6 border border-black/5">
          <div className="h-5 w-40 bg-black/5 rounded animate-pulse mb-4" />
          <div className="h-48 bg-black/5 rounded animate-pulse" />
        </div>
      </div>

      {/* Top apps skeleton */}
      <div className="glass-light rounded-xl p-6 border border-black/5">
        <div className="h-5 w-48 bg-black/5 rounded animate-pulse mb-4" />
        <div className="h-64 bg-black/5 rounded animate-pulse" />
      </div>

      {/* Recent failures skeleton */}
      <div className="glass-light rounded-xl p-6 border border-black/5">
        <div className="h-5 w-36 bg-black/5 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 py-3 border-b border-black/5 last:border-0">
              <div className="h-4 w-1/3 bg-black/5 rounded animate-pulse" />
              <div className="h-4 w-1/4 bg-black/5 rounded animate-pulse" />
              <div className="h-4 w-24 bg-black/5 rounded animate-pulse" />
              <div className="h-6 w-16 bg-black/5 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
