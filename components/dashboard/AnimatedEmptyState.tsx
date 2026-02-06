'use client';

import { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AnimatedEmptyStateProps {
  /** Main icon */
  icon: LucideIcon;
  /** Title text */
  title: string;
  /** Description text */
  description?: string;
  /** Action button */
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  };
  /** Secondary action */
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  /** Show floating gradient orbs */
  showOrbs?: boolean;
  /** Icon color theme */
  color?: 'cyan' | 'violet' | 'neutral';
  /** Custom CSS classes */
  className?: string;
  /** Floating icons around main icon */
  floatingIcons?: LucideIcon[];
  /** Custom content below description */
  children?: ReactNode;
}

const colorStyles = {
  cyan: {
    icon: 'text-accent-cyan',
    iconBg: 'bg-accent-cyan/10',
    glow: 'shadow-glow-cyan',
    gradient: 'from-accent-cyan/20 to-accent-cyan/0',
    button: 'bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90',
    orb1: 'bg-accent-cyan/30',
    orb2: 'bg-accent-violet/20'
  },
  violet: {
    icon: 'text-accent-violet',
    iconBg: 'bg-accent-violet/10',
    glow: 'shadow-glow-violet',
    gradient: 'from-accent-violet/20 to-accent-violet/0',
    button: 'bg-gradient-to-r from-accent-violet to-accent-cyan hover:opacity-90',
    orb1: 'bg-accent-violet/30',
    orb2: 'bg-accent-cyan/20'
  },
  neutral: {
    icon: 'text-text-secondary',
    iconBg: 'bg-zinc-500/10',
    glow: '',
    gradient: 'from-zinc-500/10 to-zinc-500/0',
    button: 'bg-black/10 hover:bg-black/20',
    orb1: 'bg-zinc-500/20',
    orb2: 'bg-zinc-600/10'
  }
};

export function AnimatedEmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  showOrbs = true,
  color = 'cyan',
  className,
  floatingIcons,
  children
}: AnimatedEmptyStateProps) {
  const prefersReducedMotion = useReducedMotion();
  const styles = colorStyles[color];

  const containerVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion
        ? { duration: 0.2 }
        : {
            duration: 0.6,
            ease: [0.25, 0.46, 0.45, 0.94] as const,
            staggerChildren: 0.1,
            delayChildren: 0.2
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

  const floatVariants = {
    animate: {
      y: prefersReducedMotion ? 0 : [0, -10, 0],
      transition: prefersReducedMotion
        ? { duration: 0 }
        : {
            duration: 3,
            repeat: Infinity,
            ease: 'easeInOut' as const
          }
    }
  };

  const orbVariants = {
    animate: {
      scale: prefersReducedMotion ? 1 : [1, 1.1, 1],
      opacity: prefersReducedMotion ? 0.3 : [0.3, 0.5, 0.3],
      transition: prefersReducedMotion
        ? { duration: 0 }
        : {
            duration: 4,
            repeat: Infinity,
            ease: 'easeInOut' as const
          }
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4 text-center relative',
        className
      )}
    >
      {/* Background orbs */}
      {showOrbs && !prefersReducedMotion && (
        <>
          <motion.div
            variants={orbVariants}
            animate="animate"
            className={cn(
              'absolute w-64 h-64 rounded-full blur-3xl -z-10',
              styles.orb1
            )}
            style={{ top: '10%', left: '20%' }}
          />
          <motion.div
            variants={orbVariants}
            animate="animate"
            className={cn(
              'absolute w-48 h-48 rounded-full blur-3xl -z-10',
              styles.orb2
            )}
            style={{ bottom: '20%', right: '25%', animationDelay: '1s' }}
          />
        </>
      )}

      {/* Icon container with floating effect */}
      <motion.div
        variants={floatVariants}
        animate={prefersReducedMotion ? undefined : 'animate'}
        className="relative mb-6"
      >
        {/* Floating icons */}
        {floatingIcons && !prefersReducedMotion && (
          <>
            {floatingIcons.slice(0, 3).map((FloatingIcon, index) => {
              const positions = [
                { top: '-1rem', right: '-2rem', delay: 0 },
                { bottom: '-0.5rem', left: '-2rem', delay: 0.5 },
                { top: '50%', right: '-3rem', delay: 1 }
              ];
              const pos = positions[index];

              return (
                <motion.div
                  key={index}
                  className="absolute"
                  style={{ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right }}
                  animate={{
                    y: [0, -5, 0],
                    rotate: [0, 5, -5, 0],
                    opacity: [0.4, 0.6, 0.4]
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    delay: pos.delay,
                    ease: 'easeInOut'
                  }}
                >
                  <FloatingIcon className="w-4 h-4 text-text-muted" />
                </motion.div>
              );
            })}
          </>
        )}

        {/* Main icon */}
        <div
          className={cn(
            'w-20 h-20 rounded-2xl flex items-center justify-center',
            styles.iconBg,
            !prefersReducedMotion && styles.glow
          )}
        >
          <Icon className={cn('w-10 h-10', styles.icon)} />
        </div>

        {/* Gradient ring */}
        <div
          className={cn(
            'absolute inset-0 rounded-2xl bg-gradient-radial',
            styles.gradient,
            'opacity-50'
          )}
        />
      </motion.div>

      {/* Title */}
      <motion.h3
        variants={itemVariants}
        className="text-xl font-semibold text-text-primary mb-2"
      >
        {title}
      </motion.h3>

      {/* Description */}
      {description && (
        <motion.p
          variants={itemVariants}
          className="text-sm text-text-secondary max-w-sm mb-6"
        >
          {description}
        </motion.p>
      )}

      {/* Custom content */}
      {children && (
        <motion.div variants={itemVariants} className="mb-6">
          {children}
        </motion.div>
      )}

      {/* Actions */}
      {(action || secondaryAction) && (
        <motion.div
          variants={itemVariants}
          className="flex items-center gap-3"
        >
          {action && (
            <button
              onClick={action.onClick}
              className={cn(
                'px-6 py-2.5 rounded-lg font-medium transition-all duration-200',
                action.variant === 'secondary'
                  ? 'bg-black/10 hover:bg-black/20 text-text-primary'
                  : cn(styles.button, 'text-text-primary')
              )}
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="px-6 py-2.5 rounded-lg font-medium text-text-secondary hover:text-text-primary hover:bg-black/5 transition-all duration-200"
            >
              {secondaryAction.label}
            </button>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

// Inline empty state for smaller areas
interface InlineEmptyStateProps {
  icon: LucideIcon;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function InlineEmptyState({
  icon: Icon,
  message,
  action,
  className
}: InlineEmptyStateProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex flex-col items-center justify-center py-8 px-4 text-center',
        className
      )}
    >
      <div className="w-12 h-12 rounded-xl bg-black/5 flex items-center justify-center mb-3">
        <Icon className="w-6 h-6 text-text-muted" />
      </div>
      <p className="text-sm text-text-secondary mb-3">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="text-sm text-accent-cyan hover:text-accent-cyan-bright transition-colors"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
