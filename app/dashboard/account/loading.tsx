export default function AccountLoading() {
  return (
    <div className="max-w-3xl space-y-6">
      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-8 w-32 bg-black/5 rounded animate-pulse mb-2" />
        <div className="h-4 w-72 bg-black/5 rounded animate-pulse" />
      </div>

      {/* Profile section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-black/5">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-black/5 animate-pulse" />
          <div className="h-5 w-20 bg-black/5 rounded animate-pulse" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-start gap-6">
          {/* Avatar skeleton */}
          <div className="w-20 h-20 rounded-full bg-black/5 animate-pulse flex-shrink-0" />
          {/* Profile info skeleton */}
          <div className="flex-1 space-y-4">
            <div className="flex justify-between py-3 border-b border-black/5">
              <div className="h-4 w-16 bg-black/5 rounded animate-pulse" />
              <div className="h-4 w-32 bg-black/5 rounded animate-pulse" />
            </div>
            <div className="flex justify-between py-3 border-b border-black/5">
              <div className="h-4 w-16 bg-black/5 rounded animate-pulse" />
              <div className="h-4 w-48 bg-black/5 rounded animate-pulse" />
            </div>
            <div className="flex justify-between py-3">
              <div className="h-4 w-32 bg-black/5 rounded animate-pulse" />
              <div className="h-4 w-40 bg-black/5 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>

      {/* Stats section skeleton */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-black/5 animate-pulse" />
          <div className="h-5 w-36 bg-black/5 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-light rounded-xl p-6 border border-black/5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="h-4 w-24 bg-black/5 rounded animate-pulse mb-3" />
                  <div className="h-8 w-16 bg-black/10 rounded animate-pulse mb-2" />
                  <div className="h-3 w-20 bg-black/5 rounded animate-pulse" />
                </div>
                <div className="w-12 h-12 rounded-xl bg-black/5 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tenant section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-black/5">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-black/5 animate-pulse" />
          <div className="h-5 w-32 bg-black/5 rounded animate-pulse" />
        </div>
        <div className="space-y-4">
          <div className="flex justify-between py-3 border-b border-black/5">
            <div className="h-4 w-28 bg-black/5 rounded animate-pulse" />
            <div className="h-4 w-24 bg-black/5 rounded animate-pulse" />
          </div>
          <div className="flex justify-between py-3 border-b border-black/5">
            <div className="h-4 w-20 bg-black/5 rounded animate-pulse" />
            <div className="h-4 w-64 bg-black/5 rounded animate-pulse" />
          </div>
          <div className="flex justify-between py-3">
            <div className="h-4 w-24 bg-black/5 rounded animate-pulse" />
            <div className="h-4 w-32 bg-black/5 rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Session section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-black/5">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-black/5 animate-pulse" />
          <div className="h-5 w-20 bg-black/5 rounded animate-pulse" />
        </div>
        <div className="space-y-4">
          <div className="flex justify-between py-3 border-b border-black/5">
            <div className="h-4 w-24 bg-black/5 rounded animate-pulse" />
            <div className="h-6 w-32 bg-black/5 rounded-full animate-pulse" />
          </div>
          <div className="flex justify-between py-3">
            <div className="h-4 w-36 bg-black/5 rounded animate-pulse" />
            <div className="h-4 w-32 bg-black/5 rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Danger zone skeleton */}
      <div className="rounded-xl p-6 border border-black/5 bg-black/[0.02]">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-black/5 animate-pulse" />
          <div className="h-5 w-20 bg-black/5 rounded animate-pulse" />
        </div>
        <div className="h-4 w-3/4 bg-black/5 rounded animate-pulse mb-4" />
        <div className="h-10 w-28 bg-black/5 rounded animate-pulse" />
      </div>
    </div>
  );
}
