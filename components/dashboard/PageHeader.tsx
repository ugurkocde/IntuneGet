'use client';

import { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  /** Page title */
  title: string;
  /** Page description */
  description?: string;
  /** Icon to display next to title */
  icon?: LucideIcon;
  /** Enable gradient text for title */
  gradient?: boolean;
  /** Gradient color scheme */
  gradientColors?: 'cyan' | 'violet' | 'mixed';
  /** Action buttons slot */
  actions?: ReactNode;
  /** Badge/tag to show next to title */
  badge?: {
    text: string;
    variant?: 'default' | 'success' | 'warning' | 'error';
  };
  /** Breadcrumbs */
  breadcrumbs?: Array<{
    label: string;
    href?: string;
    onClick?: () => void;
  }>;
  /** Custom CSS classes */
  className?: string;
  /** Animation delay */
  delay?: number;
}

const badgeVariants = {
  default: 'bg-black/10 text-text-secondary',
  success: 'bg-status-success/10 text-status-success',
  warning: 'bg-status-warning/10 text-status-warning',
  error: 'bg-status-error/10 text-status-error'
};

const gradientClasses = {
  cyan: 'gradient-text-cyan',
  violet: 'gradient-text-violet',
  mixed: 'gradient-text-mixed'
};

export function PageHeader({
  title,
  description,
  icon: Icon,
  gradient = false,
  gradientColors = 'mixed',
  actions,
  badge,
  breadcrumbs,
  className,
  delay = 0
}: PageHeaderProps) {
  const prefersReducedMotion = useReducedMotion();

  const containerVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion
        ? { duration: 0.2 }
        : {
            duration: 0.5,
            delay,
            ease: [0.25, 0.46, 0.45, 0.94] as const,
            staggerChildren: 0.1
          }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion ? { duration: 0.15 } : { duration: 0.4 }
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={cn('mb-8', className)}
    >
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <motion.nav
          variants={itemVariants}
          className="flex items-center gap-2 text-sm text-text-muted mb-4"
          aria-label="Breadcrumb"
        >
          {breadcrumbs.map((crumb, index) => (
            <span key={index} className="flex items-center gap-2">
              {index > 0 && <span>/</span>}
              {crumb.href || crumb.onClick ? (
                <button
                  onClick={crumb.onClick}
                  className="hover:text-text-primary transition-colors"
                >
                  {crumb.label}
                </button>
              ) : (
                <span className={index === breadcrumbs.length - 1 ? 'text-text-secondary' : ''}>
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
        </motion.nav>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Title section */}
        <motion.div variants={itemVariants} className="flex items-center gap-4">
          {/* Icon */}
          {Icon && (
            <div className="w-12 h-12 rounded-xl bg-accent-cyan/10 flex items-center justify-center">
              <Icon className="w-6 h-6 text-accent-cyan" />
            </div>
          )}

          <div>
            {/* Title with optional badge */}
            <div className="flex items-center gap-3">
              <h1
                className={cn(
                  'text-2xl sm:text-3xl font-bold',
                  gradient ? gradientClasses[gradientColors] : 'text-text-primary'
                )}
              >
                {title}
              </h1>
              {badge && (
                <span
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs font-medium',
                    badgeVariants[badge.variant ?? 'default']
                  )}
                >
                  {badge.text}
                </span>
              )}
            </div>

            {/* Description */}
            {description && (
              <p className="text-text-secondary mt-1 text-sm sm:text-base">
                {description}
              </p>
            )}
          </div>
        </motion.div>

        {/* Actions */}
        {actions && (
          <motion.div
            variants={itemVariants}
            className="flex items-center gap-3 flex-shrink-0"
          >
            {actions}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// Simple inline header for sections
interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  description,
  actions,
  className
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4',
        className
      )}
    >
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        {description && (
          <p className="text-sm text-text-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// Card header component
interface CardHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({
  title,
  description,
  icon: Icon,
  actions,
  className
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 pb-4 mb-4 border-b border-black/5',
        className
      )}
    >
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-accent-cyan" />
          </div>
        )}
        <div>
          <h3 className="font-semibold text-text-primary">{title}</h3>
          {description && (
            <p className="text-sm text-text-secondary">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
