import { SkeletonGrid } from '@/components/dashboard';

export default function MspLoading() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-8 w-48 bg-black/5 rounded animate-pulse mb-2" />
        <div className="h-4 w-32 bg-black/5 rounded animate-pulse" />
      </div>

      {/* Stats overview skeleton */}
      <SkeletonGrid count={4} columns={4} variant="stat" />

      {/* Main content grid skeleton */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Tenants section skeleton */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-5 w-32 bg-black/5 rounded animate-pulse" />
            <div className="h-4 w-16 bg-black/5 rounded animate-pulse" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 glass-light rounded-xl border border-black/5 animate-pulse" />
            ))}
          </div>
        </div>

        {/* Jobs section skeleton */}
        <div className="lg:col-span-2">
          <div className="glass-light rounded-xl p-6 border border-black/5">
            <div className="h-5 w-40 bg-black/5 rounded animate-pulse mb-6" />
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4 py-3 border-b border-black/5 last:border-0">
                  <div className="h-4 w-1/4 bg-black/5 rounded animate-pulse" />
                  <div className="h-4 w-1/4 bg-black/5 rounded animate-pulse" />
                  <div className="h-4 w-1/6 bg-black/5 rounded animate-pulse" />
                  <div className="h-6 w-20 bg-black/5 rounded-full animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
