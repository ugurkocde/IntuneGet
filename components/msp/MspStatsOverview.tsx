'use client';

import { motion, useReducedMotion } from 'framer-motion';
import {
  Building2,
  Package,
  CheckCircle2,
  Users,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatedCounter, PercentageCounter } from '@/components/dashboard/animations/AnimatedCounter';
import type { MspStatsOverviewProps } from '@/types/msp';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  isPercentage?: boolean;
  subtext?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'cyan' | 'violet' | 'green' | 'yellow';
  delay?: number;
}

function StatCard({
  icon,
  label,
  value,
  isPercentage,
  subtext,
  trend,
  color = 'cyan',
  delay = 0
}: StatCardProps) {
  const prefersReducedMotion = useReducedMotion();

  const colorClasses = {
    cyan: {
      iconBg: 'bg-accent-cyan/10',
      iconColor: 'text-accent-cyan',
      glow: 'hover:shadow-glow-cyan',
      border: 'border-accent-cyan/20'
    },
    violet: {
      iconBg: 'bg-accent-violet/10',
      iconColor: 'text-accent-violet',
      glow: 'hover:shadow-glow-violet',
      border: 'border-accent-violet/20'
    },
    green: {
      iconBg: 'bg-status-success/10',
      iconColor: 'text-status-success',
      glow: 'hover:shadow-glow-success',
      border: 'border-status-success/20'
    },
    yellow: {
      iconBg: 'bg-status-warning/10',
      iconColor: 'text-status-warning',
      glow: 'hover:shadow-glow-warning',
      border: 'border-status-warning/20'
    },
  };

  const styles = colorClasses[color];

  const cardVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion
        ? { duration: 0.2 }
        : {
            duration: 0.5,
            delay,
            ease: [0.25, 0.46, 0.45, 0.94] as const
          }
    }
  };

  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      className={cn(
        'p-4 rounded-xl glass-light border transition-all contain-layout',
        styles.border,
        styles.glow
      )}
    >
      <div className="flex items-start justify-between">
        <div className={cn('p-2 rounded-lg', styles.iconBg)}>
          <div className={styles.iconColor}>{icon}</div>
        </div>
        {trend && (
          <TrendingUp className={cn(
            'w-4 h-4',
            trend === 'up' && 'text-status-success',
            trend === 'down' && 'text-status-error rotate-180',
            trend === 'neutral' && 'text-text-muted'
          )} />
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold text-text-primary">
          {isPercentage ? (
            <PercentageCounter value={value} duration={1.5} />
          ) : (
            <AnimatedCounter value={value} duration={1.5} />
          )}
        </p>
        <p className="text-sm text-text-muted">{label}</p>
        {subtext && (
          <p className="text-xs text-text-muted mt-1">{subtext}</p>
        )}
      </div>
    </motion.div>
  );
}

export function MspStatsOverview({ stats, isLoading }: MspStatsOverviewProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-4 rounded-xl glass-light border border-black/5 animate-pulse">
            <div className="w-10 h-10 rounded-lg bg-black/10 mb-3" />
            <div className="w-16 h-8 bg-black/10 rounded mb-2" />
            <div className="w-24 h-4 bg-black/10 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-8 rounded-xl glass-light border border-black/5 text-center">
        <Building2 className="w-10 h-10 text-text-muted mx-auto mb-3" />
        <p className="text-text-secondary">No statistics available</p>
      </div>
    );
  }

  const successRate = stats.total_jobs > 0
    ? Math.round((stats.completed_jobs / stats.total_jobs) * 100)
    : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        icon={<Building2 className="w-5 h-5" />}
        label="Managed Tenants"
        value={stats.active_tenants}
        subtext={stats.pending_tenants > 0 ? `${stats.pending_tenants} pending` : undefined}
        color="cyan"
        delay={0}
      />

      <StatCard
        icon={<Users className="w-5 h-5" />}
        label="Team Members"
        value={stats.total_members}
        color="violet"
        delay={0.1}
      />

      <StatCard
        icon={<Package className="w-5 h-5" />}
        label="Total Jobs"
        value={stats.total_jobs}
        subtext={`${stats.completed_jobs} completed`}
        color="cyan"
        delay={0.2}
      />

      <StatCard
        icon={<CheckCircle2 className="w-5 h-5" />}
        label="Success Rate"
        value={successRate}
        isPercentage
        trend={successRate >= 90 ? 'up' : successRate >= 70 ? 'neutral' : 'down'}
        color="green"
        delay={0.3}
      />
    </div>
  );
}

export default MspStatsOverview;
