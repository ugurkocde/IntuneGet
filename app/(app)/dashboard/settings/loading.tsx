import { Skeleton } from '@/components/dashboard';

export default function SettingsLoading() {
  return (
    <div className="max-w-3xl space-y-6">
      {/* Header skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Account section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-overlay/5">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="space-y-4">
          <div className="flex justify-between py-3 border-b border-overlay/5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex justify-between py-3 border-b border-overlay/5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex justify-between py-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
      </div>

      {/* Connection section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-overlay/5">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="space-y-4">
          <div className="flex justify-between py-3 border-b border-overlay/5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex justify-between py-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
      </div>

      {/* Permissions section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-overlay/5">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-4 w-3/4 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 bg-bg-elevated rounded-lg border border-overlay/5 flex items-start gap-3">
              <Skeleton className="w-5 h-5 rounded-full mt-0.5" />
              <div className="flex-1">
                <Skeleton className="h-4 w-48 mb-2" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
