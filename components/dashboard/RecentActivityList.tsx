'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Loader2, XCircle, Ban, Clock } from 'lucide-react';
import { RecentActivityItem } from '@/hooks/useAnalytics';
import { formatRelativeTime } from '@/lib/utils';
import { InlineEmptyState } from './AnimatedEmptyState';
import { Skeleton } from './SkeletonCard';

interface RecentActivityListProps {
  activities?: RecentActivityItem[];
  loading?: boolean;
}

const statusConfig = {
  success: {
    icon: CheckCircle2,
    color: 'text-status-success',
    bgColor: 'bg-status-success/10',
  },
  pending: {
    icon: Loader2,
    color: 'text-accent-cyan',
    bgColor: 'bg-accent-cyan/10',
  },
  failed: {
    icon: XCircle,
    color: 'text-status-error',
    bgColor: 'bg-status-error/10',
  },
};


function ActivitySkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg">
          <Skeleton className="w-8 h-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RecentActivityList({ activities, loading }: RecentActivityListProps) {
  const prefersReducedMotion = useReducedMotion();

  if (loading) {
    return <ActivitySkeleton />;
  }

  if (!activities || activities.length === 0) {
    return (
      <InlineEmptyState
        icon={Clock}
        message="No recent activity. Your deployment history will appear here."
      />
    );
  }

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: prefersReducedMotion
        ? { duration: 0.2 }
        : {
            staggerChildren: 0.05,
          },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: prefersReducedMotion ? 0 : -10 },
    visible: {
      opacity: 1,
      x: 0,
      transition: prefersReducedMotion ? { duration: 0.15 } : { duration: 0.3 },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-2"
    >
      {activities.map((activity) => {
        const config = statusConfig[activity.status];
        const isCancelled = activity.description.startsWith('Cancelled');

        return (
          <motion.div
            key={activity.id}
            variants={itemVariants}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-black/5 transition-colors group"
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                isCancelled ? 'bg-status-warning/10' : config.bgColor
              }`}
            >
              {activity.status === 'pending' ? (
                <Loader2 className="w-4 h-4 text-accent-cyan animate-spin" />
              ) : isCancelled ? (
                <Ban className="w-4 h-4 text-status-warning" />
              ) : (
                <config.icon className={`w-4 h-4 ${config.color}`} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-secondary truncate group-hover:text-text-primary transition-colors">
                {activity.description}
              </p>
              <p className="text-xs text-text-muted">
                {formatRelativeTime(activity.timestamp)}
              </p>
            </div>

            {activity.intuneAppUrl && activity.status === 'success' && (
              <a
                href={activity.intuneAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-cyan hover:text-accent-cyan-bright transition-colors opacity-0 group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                View in Intune
              </a>
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
}
