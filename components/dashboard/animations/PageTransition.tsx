'use client';

import { ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { pageTransition } from '@/lib/animations';
import { cn } from '@/lib/utils';

interface PageTransitionProps {
  children: ReactNode;
  /** Unique key for the page (used for AnimatePresence) */
  pageKey?: string;
  /** Animation mode */
  mode?: 'wait' | 'sync' | 'popLayout';
  /** Custom CSS classes */
  className?: string;
  /** Animation duration */
  duration?: number;
  /** Animation delay */
  delay?: number;
  /** Enable layout animation */
  layout?: boolean;
}

export function PageTransition({
  children,
  pageKey,
  mode = 'wait',
  className,
  duration,
  delay,
  layout = false
}: PageTransitionProps) {
  const prefersReducedMotion = useReducedMotion();

  const customVariants = prefersReducedMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.2 } },
        exit: { opacity: 0, transition: { duration: 0.1 } }
      }
    : duration || delay
    ? {
        hidden: {
          opacity: 0,
          y: 8
        },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            duration: duration ?? 0.4,
            delay: delay ?? 0,
            ease: [0.25, 0.46, 0.45, 0.94] as const
          }
        },
        exit: {
          opacity: 0,
          y: -8,
          transition: {
            duration: (duration ?? 0.4) * 0.75
          }
        }
      }
    : pageTransition;

  return (
    <AnimatePresence mode={mode}>
      <motion.div
        key={pageKey}
        variants={customVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className={cn('w-full', className)}
        layout={layout && !prefersReducedMotion}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// Section wrapper for animating sections within a page
interface SectionTransitionProps {
  children: ReactNode;
  /** Delay before animation starts */
  delay?: number;
  /** Custom CSS classes */
  className?: string;
  /** Animate when scrolled into view */
  viewportAnimation?: boolean;
  /** Only animate once */
  once?: boolean;
}

export function SectionTransition({
  children,
  delay = 0,
  className,
  viewportAnimation = false,
  once = true
}: SectionTransitionProps) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  const variants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94] as const
      }
    }
  };

  if (viewportAnimation) {
    return (
      <motion.section
        variants={variants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once, amount: 0.2 }}
        className={className}
      >
        {children}
      </motion.section>
    );
  }

  return (
    <motion.section
      variants={variants}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {children}
    </motion.section>
  );
}

// Fade wrapper for simple fade animations
interface FadeTransitionProps {
  children: ReactNode;
  /** Whether content is visible */
  show?: boolean;
  /** Custom CSS classes */
  className?: string;
  /** Animation duration */
  duration?: number;
}

export function FadeTransition({
  children,
  show = true,
  className,
  duration = 0.3
}: FadeTransitionProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: prefersReducedMotion ? 0.1 : duration
          }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Slide fade for content that slides and fades
interface SlideFadeTransitionProps {
  children: ReactNode;
  /** Whether content is visible */
  show?: boolean;
  /** Slide direction */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Slide distance in pixels */
  distance?: number;
  /** Custom CSS classes */
  className?: string;
  /** Animation duration */
  duration?: number;
}

export function SlideFadeTransition({
  children,
  show = true,
  direction = 'up',
  distance = 20,
  className,
  duration = 0.4
}: SlideFadeTransitionProps) {
  const prefersReducedMotion = useReducedMotion();

  const directionMap = {
    up: { y: distance },
    down: { y: -distance },
    left: { x: distance },
    right: { x: -distance }
  };

  const initialPosition = directionMap[direction];

  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          initial={
            prefersReducedMotion ? { opacity: 0 } : { opacity: 0, ...initialPosition }
          }
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, ...initialPosition }}
          transition={{
            duration: prefersReducedMotion ? 0.1 : duration,
            ease: [0.25, 0.46, 0.45, 0.94]
          }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
