'use client';

import { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatedCounter, PercentageCounter } from './animations/AnimatedCounter';

type ColorVariant = 'cyan' | 'violet' | 'success' | 'warning' | 'error' | 'neutral';
type ValueType = 'number' | 'percentage' | 'custom';

interface AnimatedStatCardProps {
  /** Card title */
  title: string;
  /** The stat value */
  value: number | string;
  /** Type of value for proper formatting */
  valueType?: ValueType;
  /** Custom rendered value (when valueType is 'custom') */
  customValue?: ReactNode;
  /** Change indicator (e.g., "+12%") */
  change?: {
    value: number;
    label?: string;
    positive?: boolean;
  };
  /** Description or subtitle */
  description?: string;
  /** Icon to display */
  icon?: LucideIcon;
  /** Color theme */
  color?: ColorVariant;
  /** Animation delay (for staggered entrance) */
  delay?: number;
  /** Whether to show loading skeleton */
  loading?: boolean;
  /** Custom CSS classes */
  className?: string;
  /** Counter animation duration */
  counterDuration?: number;
  /** Icon position */
  iconPosition?: 'left' | 'right' | 'top';
  /** Prefix for value */
  prefix?: string;
  /** Suffix for value */
  suffix?: string;
  /** Number of decimal places */
  decimals?: number;
}

const colorStyles = {
  cyan: {
    icon: 'text-accent-cyan',
    iconBg: 'bg-accent-cyan/10',
    glow: 'hover:shadow-glow-cyan',
    border: 'border-accent-cyan/20',
    gradient: 'from-accent-cyan/5 to-transparent'
  },
  violet: {
    icon: 'text-accent-violet',
    iconBg: 'bg-accent-violet/10',
    glow: 'hover:shadow-glow-violet',
    border: 'border-accent-violet/20',
    gradient: 'from-accent-violet/5 to-transparent'
  },
  success: {
    icon: 'text-status-success',
    iconBg: 'bg-status-success/10',
    glow: 'hover:shadow-glow-success',
    border: 'border-status-success/20',
    gradient: 'from-status-success/5 to-transparent'
  },
  warning: {
    icon: 'text-status-warning',
    iconBg: 'bg-status-warning/10',
    glow: 'hover:shadow-glow-warning',
    border: 'border-status-warning/20',
    gradient: 'from-status-warning/5 to-transparent'
  },
  error: {
    icon: 'text-status-error',
    iconBg: 'bg-status-error/10',
    glow: 'hover:shadow-glow-error',
    border: 'border-status-error/20',
    gradient: 'from-status-error/5 to-transparent'
  },
  neutral: {
    icon: 'text-text-secondary',
    iconBg: 'bg-zinc-500/10',
    glow: '',
    border: 'border-black/5',
    gradient: 'from-white/5 to-transparent'
  }
};

export function AnimatedStatCard({
  title,
  value,
  valueType = 'number',
  customValue,
  change,
  description,
  icon: Icon,
  color = 'cyan',
  delay = 0,
  loading = false,
  className,
  counterDuration = 1.5,
  iconPosition = 'right',
  prefix,
  suffix,
  decimals = 0
}: AnimatedStatCardProps) {
  const prefersReducedMotion = useReducedMotion();
  const styles = colorStyles[color];

  // Loading skeleton
  if (loading) {
    return (
      <div
        className={cn(
          'glass-light rounded-xl p-6 border border-black/5',
          className
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="h-4 w-24 bg-black/5 rounded animate-pulse mb-3" />
            <div className="h-8 w-32 bg-black/10 rounded animate-pulse mb-2" />
            <div className="h-3 w-20 bg-black/5 rounded animate-pulse" />
          </div>
          <div className="w-12 h-12 rounded-xl bg-black/5 animate-pulse" />
        </div>
      </div>
    );
  }

  const renderValue = () => {
    if (valueType === 'custom' && customValue) {
      return customValue;
    }

    if (typeof value === 'string') {
      return (
        <span className="text-3xl font-bold text-text-primary tabular-nums">
          {prefix}
          {value}
          {suffix}
        </span>
      );
    }

    if (valueType === 'percentage') {
      return (
        <PercentageCounter
          value={value}
          decimals={decimals}
          duration={counterDuration}
          className="text-3xl font-bold text-text-primary"
        />
      );
    }

    return (
      <AnimatedCounter
        value={value}
        prefix={prefix}
        suffix={suffix}
        decimals={decimals}
        duration={counterDuration}
        className="text-3xl font-bold text-text-primary"
      />
    );
  };

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
        'glass-light rounded-xl p-6 border transition-all duration-300 contain-layout',
        styles.border,
        styles.glow,
        `bg-gradient-to-br ${styles.gradient}`,
        className
      )}
    >
      <div
        className={cn(
          'flex',
          iconPosition === 'top'
            ? 'flex-col gap-4'
            : 'items-start justify-between'
        )}
      >
        {/* Icon (left or top position) */}
        {Icon && (iconPosition === 'left' || iconPosition === 'top') && (
          <div
            className={cn(
              'w-12 h-12 rounded-xl flex items-center justify-center',
              styles.iconBg,
              iconPosition === 'left' && 'mr-4'
            )}
          >
            <Icon className={cn('w-6 h-6', styles.icon)} />
          </div>
        )}

        {/* Content */}
        <div className="flex-1">
          <p className="text-sm font-medium text-text-secondary mb-1">{title}</p>
          {renderValue()}

          {/* Change indicator */}
          {change && (
            <div className="flex items-center gap-2 mt-2">
              <span
                className={cn(
                  'text-sm font-medium',
                  change.positive !== false
                    ? 'text-status-success'
                    : 'text-status-error'
                )}
              >
                {change.positive !== false ? '+' : ''}
                {change.value}%
              </span>
              {change.label && (
                <span className="text-xs text-text-muted">{change.label}</span>
              )}
            </div>
          )}

          {/* Description */}
          {description && (
            <p className="text-xs text-text-muted mt-2">{description}</p>
          )}
        </div>

        {/* Icon (right position) */}
        {Icon && iconPosition === 'right' && (
          <div
            className={cn(
              'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
              styles.iconBg
            )}
          >
            <Icon className={cn('w-6 h-6', styles.icon)} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Grid container for stat cards
interface StatCardGridProps {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export function StatCardGrid({
  children,
  columns = 4,
  className
}: StatCardGridProps) {
  const prefersReducedMotion = useReducedMotion();

  const columnClasses = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
  };

  const containerVariants = prefersReducedMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1 }
      }
    : {
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: 0.1,
            delayChildren: 0.1
          }
        }
      };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={cn('grid gap-4', columnClasses[columns], className)}
    >
      {children}
    </motion.div>
  );
}
