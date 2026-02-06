'use client';

import { cn } from '@/lib/utils';

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('bg-black/5 rounded animate-pulse', className)} />;
}

export function UnmanagedGridSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="glass-light rounded-xl p-5 border border-black/5">
          <div className="flex items-start gap-4">
            <SkeletonBlock className="w-12 h-12 rounded-xl flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-5 w-3/4" />
              <SkeletonBlock className="h-4 w-1/2" />
              <div className="flex items-center gap-3 mt-3">
                <SkeletonBlock className="h-4 w-20" />
                <SkeletonBlock className="h-5 w-16 rounded-full" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end mt-4 pt-4 border-t border-black/5">
            <SkeletonBlock className="h-8 w-20 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function UnmanagedListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 p-4 rounded-xl bg-black/[0.02] border border-black/[0.03]"
        >
          <SkeletonBlock className="w-10 h-10 rounded-xl flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <SkeletonBlock className="h-4 w-48" />
            <SkeletonBlock className="h-3 w-32" />
          </div>
          <SkeletonBlock className="h-4 w-12 hidden sm:block" />
          <SkeletonBlock className="h-5 w-16 rounded-full hidden sm:block" />
          <SkeletonBlock className="h-8 w-16 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function UnmanagedPageSkeleton() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <SkeletonBlock className="w-12 h-12 rounded-xl" />
          <div className="space-y-2">
            <SkeletonBlock className="h-7 w-48" />
            <SkeletonBlock className="h-4 w-72" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SkeletonBlock className="h-8 w-28 rounded-lg" />
          <SkeletonBlock className="h-9 w-24 rounded-lg" />
        </div>
      </div>

      {/* Stat cards skeleton (4 cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-light rounded-xl p-6 border border-black/5">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-3">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-8 w-32" />
                <SkeletonBlock className="h-3 w-20" />
              </div>
              <SkeletonBlock className="w-12 h-12 rounded-xl" />
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar skeleton */}
      <div className="glass-light rounded-xl p-4 border border-black/5 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <SkeletonBlock className="h-10 flex-1 rounded-lg" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-9 w-28 rounded-lg" />
            <SkeletonBlock className="h-9 w-64 rounded-lg" />
            <SkeletonBlock className="h-9 w-20 rounded-lg" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
      </div>

      {/* Grid skeleton */}
      <UnmanagedGridSkeleton />
    </div>
  );
}
