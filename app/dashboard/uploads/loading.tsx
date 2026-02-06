import { SkeletonGrid } from '@/components/dashboard';

export default function UploadsLoading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-8 w-32 bg-black/5 rounded animate-pulse mb-2" />
        <div className="h-4 w-72 bg-black/5 rounded animate-pulse" />
      </div>

      {/* Stats grid skeleton */}
      <SkeletonGrid count={4} columns={4} variant="stat" />

      {/* Filters skeleton */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-2">
          {['All', 'Pending', 'Processing', 'Completed', 'Failed'].map((_, i) => (
            <div key={i} className="h-8 w-20 bg-black/5 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-10 w-64 bg-black/5 rounded-lg animate-pulse" />
      </div>

      {/* Jobs list skeleton */}
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="glass-light rounded-xl p-6 border border-black/5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-black/5 animate-pulse" />
                <div>
                  <div className="h-5 w-48 bg-black/5 rounded animate-pulse mb-2" />
                  <div className="h-4 w-32 bg-black/5 rounded animate-pulse" />
                </div>
              </div>
              <div className="h-6 w-24 bg-black/5 rounded-full animate-pulse" />
            </div>
            <div className="h-2 w-full bg-black/5 rounded-full animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
