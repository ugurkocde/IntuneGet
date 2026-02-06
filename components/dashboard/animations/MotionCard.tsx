'use client';

import { ReactNode, forwardRef, HTMLAttributes } from 'react';
import { motion, HTMLMotionProps, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { cardHover, cardHoverSubtle, cardHoverGlow, fadeUp } from '@/lib/animations';

/**
 * Extract standard HTML div attributes from motion props.
 * This filters out framer-motion specific properties that aren't valid on a regular div.
 */
function extractDivProps(
  props: Omit<HTMLMotionProps<'div'>, 'children'>
): HTMLAttributes<HTMLDivElement> {
  const {
    // Filter out motion-specific props
    initial,
    animate,
    exit,
    variants,
    transition,
    whileHover,
    whileTap,
    whileFocus,
    whileDrag,
    whileInView,
    viewport,
    layout,
    layoutId,
    layoutDependency,
    layoutScroll,
    layoutRoot,
    onLayoutAnimationStart,
    onLayoutAnimationComplete,
    onAnimationStart,
    onAnimationComplete,
    onUpdate,
    onDragStart,
    onDrag,
    onDragEnd,
    onDirectionLock,
    onDragTransitionEnd,
    onViewportEnter,
    onViewportLeave,
    drag,
    dragConstraints,
    dragSnapToOrigin,
    dragElastic,
    dragMomentum,
    dragTransition,
    dragPropagation,
    dragControls,
    dragListener,
    dragDirectionLock,
    onPan,
    onPanStart,
    onPanEnd,
    onPanSessionStart,
    onTap,
    onTapStart,
    onTapCancel,
    onHoverStart,
    onHoverEnd,
    onFocusCapture,
    transformTemplate,
    custom,
    inherit,
    ...divProps
  } = props;

  return divProps as HTMLAttributes<HTMLDivElement>;
}

type CardVariant = 'default' | 'subtle' | 'glow';

interface MotionCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  /** Hover animation style */
  variant?: CardVariant;
  /** Custom CSS classes */
  className?: string;
  /** Enable glass morphism styling */
  glass?: boolean;
  /** Glow color for hover effect */
  glowColor?: 'cyan' | 'violet' | 'success' | 'warning' | 'error';
  /** Enable entrance animation */
  animate?: boolean;
  /** Animation delay (for staggered lists) */
  delay?: number;
  /** Animate when scrolled into view */
  viewportAnimation?: boolean;
  /** Border styling */
  border?: boolean;
  /** Background opacity */
  bgOpacity?: 'low' | 'medium' | 'high';
}

const glowColorClasses = {
  cyan: 'hover:shadow-glow-cyan',
  violet: 'hover:shadow-glow-violet',
  success: 'hover:shadow-glow-success',
  warning: 'hover:shadow-glow-warning',
  error: 'hover:shadow-glow-error'
};

const bgOpacityClasses = {
  low: 'bg-bg-surface/30',
  medium: 'bg-bg-surface/50',
  high: 'bg-bg-surface/80'
};

const hoverVariants = {
  default: cardHover,
  subtle: cardHoverSubtle,
  glow: cardHoverGlow
};

export const MotionCard = forwardRef<HTMLDivElement, MotionCardProps>(
  (
    {
      children,
      variant = 'default',
      className,
      glass = true,
      glowColor = 'cyan',
      animate = true,
      delay = 0,
      viewportAnimation = false,
      border = true,
      bgOpacity = 'medium',
      ...props
    },
    ref
  ) => {
    const prefersReducedMotion = useReducedMotion();

    // Base classes
    const baseClasses = cn(
      'rounded-xl p-6 transition-colors contain-layout',
      glass && 'backdrop-blur-md',
      border && 'border border-black/5',
      bgOpacityClasses[bgOpacity],
      !prefersReducedMotion && glowColorClasses[glowColor],
      className
    );

    // Build motion props
    const motionProps: HTMLMotionProps<'div'> = {
      ...props,
      className: baseClasses
    };

    // Add hover animations (unless reduced motion)
    if (!prefersReducedMotion) {
      motionProps.variants = hoverVariants[variant];
      motionProps.initial = animate ? 'hidden' : 'rest';
      motionProps.whileHover = 'hover';
      motionProps.whileTap = 'tap';

      // Add entrance animation
      if (animate) {
        if (viewportAnimation) {
          motionProps.whileInView = 'visible';
          motionProps.viewport = { once: true, amount: 0.3 };
          motionProps.variants = {
            ...fadeUp,
            hover: hoverVariants[variant].hover,
            tap: hoverVariants[variant].tap,
            rest: hoverVariants[variant].rest
          };
        } else {
          motionProps.animate = 'visible';
          motionProps.variants = {
            hidden: { opacity: 0, y: 20 },
            visible: {
              opacity: 1,
              y: 0,
              transition: {
                duration: 0.5,
                delay,
                ease: [0.25, 0.46, 0.45, 0.94]
              }
            },
            hover: hoverVariants[variant].hover,
            tap: hoverVariants[variant].tap,
            rest: hoverVariants[variant].rest
          };
        }
      }
    }

    return (
      <motion.div ref={ref} {...motionProps}>
        {children}
      </motion.div>
    );
  }
);

MotionCard.displayName = 'MotionCard';

// Simple variant without hover effects (for containers)
interface MotionContainerProps extends Omit<MotionCardProps, 'variant'> {
  /** Animation type */
  animation?: 'fade' | 'scale' | 'slide' | 'none';
}

export const MotionContainer = forwardRef<HTMLDivElement, MotionContainerProps>(
  (
    {
      children,
      className,
      glass = true,
      animate = true,
      delay = 0,
      viewportAnimation = false,
      border = true,
      bgOpacity = 'medium',
      animation = 'fade',
      ...props
    },
    ref
  ) => {
    const prefersReducedMotion = useReducedMotion();

    const baseClasses = cn(
      'rounded-xl p-6 transition-colors',
      glass && 'backdrop-blur-md',
      border && 'border border-black/5',
      bgOpacityClasses[bgOpacity],
      className
    );

    if (!animate || prefersReducedMotion) {
      return (
        <div ref={ref} className={baseClasses} {...extractDivProps(props)}>
          {children}
        </div>
      );
    }

    const animationVariants = {
      fade: {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.4, delay } }
      },
      scale: {
        initial: { opacity: 0, scale: 0.95 },
        animate: { opacity: 1, scale: 1, transition: { duration: 0.4, delay } }
      },
      slide: {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0, transition: { duration: 0.5, delay } }
      },
      none: {
        initial: {},
        animate: {}
      }
    };

    const motionProps: HTMLMotionProps<'div'> = {
      ...props,
      className: baseClasses,
      ...animationVariants[animation]
    };

    if (viewportAnimation) {
      return (
        <motion.div
          ref={ref}
          className={baseClasses}
          initial={animationVariants[animation].initial}
          whileInView={animationVariants[animation].animate}
          viewport={{ once: true, amount: 0.3 }}
          {...props}
        >
          {children}
        </motion.div>
      );
    }

    return (
      <motion.div ref={ref} {...motionProps}>
        {children}
      </motion.div>
    );
  }
);

MotionContainer.displayName = 'MotionContainer';
