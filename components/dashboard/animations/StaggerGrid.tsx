'use client';

import { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { staggerContainer, fadeUp } from '@/lib/animations';

interface StaggerGridProps {
  children: ReactNode;
  className?: string;
  /** Number of columns (responsive by default) */
  columns?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Gap between items */
  gap?: 'sm' | 'md' | 'lg' | 'xl';
  /** Stagger delay between each item */
  staggerDelay?: number;
  /** Initial delay before animation starts */
  delayChildren?: number;
  /** Enable viewport-based animation (animate when scrolled into view) */
  viewportAnimation?: boolean;
  /** Only animate once when in viewport */
  animateOnce?: boolean;
}

const gapClasses = {
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
  xl: 'gap-8'
};

const columnClasses = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
  6: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6'
};

export function StaggerGrid({
  children,
  className,
  columns = 3,
  gap = 'md',
  staggerDelay = 0.1,
  delayChildren = 0.1,
  viewportAnimation = false,
  animateOnce = true
}: StaggerGridProps) {
  const prefersReducedMotion = useReducedMotion();

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
            staggerChildren: staggerDelay,
            delayChildren
          }
        }
      };

  const baseProps = {
    variants: containerVariants,
    initial: 'hidden',
    className: cn('grid', columnClasses[columns], gapClasses[gap], className)
  };

  if (viewportAnimation) {
    return (
      <motion.div
        {...baseProps}
        whileInView="visible"
        viewport={{ once: animateOnce, amount: 0.1 }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div {...baseProps} animate="visible">
      {children}
    </motion.div>
  );
}

// Export a wrapper for individual items to use with StaggerGrid
interface StaggerItemProps {
  children: ReactNode;
  className?: string;
}

export function StaggerItem({ children, className }: StaggerItemProps) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div variants={fadeUp} className={className}>
      {children}
    </motion.div>
  );
}
