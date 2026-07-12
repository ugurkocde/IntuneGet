import { Skeleton, SkeletonAvatar, SkeletonGrid } from '@/components/dashboard';

export default function AccountLoading() {
  return (
    <div className="max-w-3xl space-y-6">
      {/* Header skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Profile section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-overlay/5">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-start gap-6">
          <SkeletonAvatar size="lg" className="w-20 h-20 flex-shrink-0" />
          <div className="flex-1 space-y-4">
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
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        </div>
      </div>

      {/* Stats section skeleton */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <Skeleton className="h-5 w-36" />
        </div>
        <SkeletonGrid count={4} columns={2} variant="stat" />
      </div>

      {/* Tenant section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-overlay/5">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="space-y-4">
          <div className="flex justify-between py-3 border-b border-overlay/5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex justify-between py-3 border-b border-overlay/5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex justify-between py-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>

      {/* Session section skeleton */}
      <div className="glass-light rounded-xl p-6 border border-overlay/5">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="space-y-4">
          <div className="flex justify-between py-3 border-b border-overlay/5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-32 rounded-full" />
          </div>
          <div className="flex justify-between py-3">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>

      {/* Danger zone skeleton */}
      <div className="rounded-xl p-6 border border-overlay/5 bg-overlay/[0.02]">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-4 w-3/4 mb-4" />
        <Skeleton className="h-10 w-28" />
      </div>
    </div>
  );
}
