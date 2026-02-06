export default function SettingsLoading() {
  return (
    <div className="max-w-3xl space-y-6">
      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-8 w-32 bg-black/5 rounded animate-pulse mb-2" />
        <div className="h-4 w-64 bg-black/5 rounded animate-pulse" />
      </div>

      {/* Account section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-black/5">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-black/5 animate-pulse" />
          <div className="h-5 w-24 bg-black/5 rounded animate-pulse" />
        </div>
        <div className="space-y-4">
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
            <div className="h-4 w-28 bg-black/5 rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Connection section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-black/5">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-black/5 animate-pulse" />
          <div className="h-5 w-36 bg-black/5 rounded animate-pulse" />
        </div>
        <div className="space-y-4">
          <div className="flex justify-between py-3 border-b border-black/5">
            <div className="h-4 w-16 bg-black/5 rounded animate-pulse" />
            <div className="h-4 w-24 bg-black/5 rounded animate-pulse" />
          </div>
          <div className="flex justify-between py-3">
            <div className="h-4 w-20 bg-black/5 rounded animate-pulse" />
            <div className="h-4 w-64 bg-black/5 rounded animate-pulse font-mono" />
          </div>
        </div>
      </div>

      {/* Permissions section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-black/5">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-black/5 animate-pulse" />
          <div className="h-5 w-32 bg-black/5 rounded animate-pulse" />
        </div>
        <div className="h-4 w-3/4 bg-black/5 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 bg-bg-elevated rounded-lg border border-black/5 flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-black/5 animate-pulse mt-0.5" />
              <div className="flex-1">
                <div className="h-4 w-48 bg-black/5 rounded animate-pulse mb-2" />
                <div className="h-3 w-32 bg-black/5 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
