import { Skeleton } from '@/components/dashboard';

export default function AppsLoading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-36 mb-2" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Search and filters skeleton */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <Skeleton className="w-full lg:w-96 h-10 rounded-lg" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-32 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
        </div>
      </div>

      {/* Category tabs skeleton */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-lg flex-shrink-0" />
        ))}
      </div>

      {/* Apps grid skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="glass-light rounded-xl p-4 border border-overlay/5">
            <div className="flex items-start gap-3 mb-3">
              <Skeleton className="w-12 h-12 rounded-xl flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <Skeleton className="h-5 w-3/4 mb-2" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-2/3 mb-4" />
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
