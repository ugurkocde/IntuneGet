'use client';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

// Base skeleton element with shimmer
export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded bg-black/5',
        'relative overflow-hidden',
        // Shimmer effect
        "after:absolute after:inset-0 after:-translate-x-full",
        "after:animate-shimmer after:bg-gradient-to-r",
        "after:from-transparent after:via-white/5 after:to-transparent",
        className
      )}
      style={style}
    />
  );
}

// Skeleton card matching the glass-light style
interface SkeletonCardProps {
  className?: string;
  /** Number of text lines to show */
  lines?: number;
  /** Show icon placeholder */
  showIcon?: boolean;
  /** Show header area */
  showHeader?: boolean;
  /** Variant layout */
  variant?: 'stat' | 'content' | 'list-item' | 'chart';
}

export function SkeletonCard({
  className,
  lines = 3,
  showIcon = false,
  showHeader = false,
  variant = 'content'
}: SkeletonCardProps) {
  // Stat card skeleton
  if (variant === 'stat') {
    return (
      <div
        className={cn(
          'glass-light rounded-xl p-6 border border-black/5',
          className
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="w-12 h-12 rounded-xl" />
        </div>
      </div>
    );
  }

  // Chart card skeleton
  if (variant === 'chart') {
    return (
      <div
        className={cn(
          'glass-light rounded-xl p-6 border border-black/5',
          className
        )}
      >
        {showHeader && (
          <div className="flex items-center justify-between mb-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        )}
        <div className="flex items-end justify-between gap-2 h-40">
          {[...Array(7)].map((_, i) => (
            <Skeleton
              key={i}
              className="flex-1"
              style={{ height: `${30 + Math.random() * 70}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  // List item skeleton
  if (variant === 'list-item') {
    return (
      <div
        className={cn(
          'glass-light rounded-xl p-4 border border-black/5 flex items-center gap-4',
          className
        )}
      >
        {showIcon && <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <Skeleton className="h-4 w-3/4 mb-2" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="w-16 h-6 rounded-full flex-shrink-0" />
      </div>
    );
  }

  // Default content card skeleton
  return (
    <div
      className={cn(
        'glass-light rounded-xl p-6 border border-black/5',
        className
      )}
    >
      {showHeader && (
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-black/5">
          <Skeleton className="h-5 w-32" />
          {showIcon && <Skeleton className="w-8 h-8 rounded-lg" />}
        </div>
      )}
      <div className="space-y-3">
        {[...Array(lines)].map((_, i) => (
          <Skeleton
            key={i}
            className={cn('h-4', i === lines - 1 ? 'w-2/3' : 'w-full')}
          />
        ))}
      </div>
    </div>
  );
}

// Grid of skeleton cards
interface SkeletonGridProps {
  count?: number;
  columns?: 2 | 3 | 4;
  variant?: 'stat' | 'content' | 'list-item' | 'chart';
  className?: string;
}

export function SkeletonGrid({
  count = 4,
  columns = 4,
  variant = 'stat',
  className
}: SkeletonGridProps) {
  const columnClasses = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
  };

  return (
    <div className={cn('grid gap-4', columnClasses[columns], className)}>
      {[...Array(count)].map((_, i) => (
        <SkeletonCard key={i} variant={variant} />
      ))}
    </div>
  );
}

// Table skeleton
interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
  showHeader?: boolean;
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
  showHeader = true
}: SkeletonTableProps) {
  return (
    <div
      className={cn(
        'glass-light rounded-xl border border-black/5 overflow-hidden',
        className
      )}
    >
      {/* Header */}
      {showHeader && (
        <div className="flex items-center gap-4 px-6 py-4 border-b border-black/5 bg-black/[0.02]">
          {[...Array(columns)].map((_, i) => (
            <Skeleton
              key={i}
              className={cn('h-4', i === 0 ? 'w-1/3' : 'w-1/4')}
            />
          ))}
        </div>
      )}

      {/* Rows */}
      <div className="divide-y divide-white/5">
        {[...Array(rows)].map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 px-6 py-4">
            {[...Array(columns)].map((_, colIndex) => (
              <Skeleton
                key={colIndex}
                className={cn(
                  'h-4',
                  colIndex === 0 ? 'w-1/3' : colIndex === columns - 1 ? 'w-16' : 'w-1/4'
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Text skeleton for paragraphs
interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {[...Array(lines)].map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-4', i === lines - 1 ? 'w-3/4' : 'w-full')}
        />
      ))}
    </div>
  );
}

// Avatar skeleton
interface SkeletonAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function SkeletonAvatar({ size = 'md', className }: SkeletonAvatarProps) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-16 h-16'
  };

  return (
    <Skeleton className={cn('rounded-full', sizeClasses[size], className)} />
  );
}
