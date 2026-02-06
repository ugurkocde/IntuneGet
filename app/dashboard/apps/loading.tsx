export default function AppsLoading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-8 w-36 bg-black/5 rounded animate-pulse mb-2" />
        <div className="h-4 w-80 bg-black/5 rounded animate-pulse" />
      </div>

      {/* Search and filters skeleton */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <div className="w-full lg:w-96 h-10 bg-black/5 rounded-lg animate-pulse" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-32 bg-black/5 rounded-lg animate-pulse" />
          <div className="h-10 w-24 bg-black/5 rounded-lg animate-pulse" />
        </div>
      </div>

      {/* Category tabs skeleton */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-9 w-24 bg-black/5 rounded-lg animate-pulse flex-shrink-0" />
        ))}
      </div>

      {/* Apps grid skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="glass-light rounded-xl p-4 border border-black/5">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-black/5 animate-pulse flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="h-5 w-3/4 bg-black/5 rounded animate-pulse mb-2" />
                <div className="h-3 w-1/2 bg-black/5 rounded animate-pulse" />
              </div>
            </div>
            <div className="h-4 w-full bg-black/5 rounded animate-pulse mb-2" />
            <div className="h-4 w-2/3 bg-black/5 rounded animate-pulse mb-4" />
            <div className="flex items-center justify-between">
              <div className="h-6 w-16 bg-black/5 rounded-full animate-pulse" />
              <div className="h-8 w-20 bg-black/5 rounded-lg animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
