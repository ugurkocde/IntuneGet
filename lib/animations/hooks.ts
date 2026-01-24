'use client';

import { useCallback, useMemo } from 'react';
import { useReducedMotion, MotionProps } from 'framer-motion';
import { fadeUp, scaleIn, cardHover, buttonPress, fadeIn, springPresets } from './variants';

/**
 * Hook that respects user's reduced motion preference
 * Returns animation props that disable animations if user prefers reduced motion
 */
export function useAnimationProps(
  animationProps: MotionProps,
  options?: {
    respectReducedMotion?: boolean;
    fallbackOpacityOnly?: boolean;
  }
): MotionProps {
  const prefersReducedMotion = useReducedMotion();
  const { respectReducedMotion = true, fallbackOpacityOnly = true } = options ?? {};

  return useMemo(() => {
    if (prefersReducedMotion && respectReducedMotion) {
      if (fallbackOpacityOnly) {
        // Provide simple opacity fade for accessibility
        return {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          exit: { opacity: 0 },
          transition: { duration: 0.2 }
        };
      }
      // No animation at all
      return {};
    }
    return animationProps;
  }, [animationProps, prefersReducedMotion, respectReducedMotion, fallbackOpacityOnly]);
}

/**
 * Hook to get fade-up animation with reduced motion support
 */
export function useFadeUpAnimation(delay?: number): MotionProps {
  const prefersReducedMotion = useReducedMotion();

  return useMemo(() => {
    if (prefersReducedMotion) {
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.2, delay }
      };
    }
    return {
      variants: fadeUp,
      initial: 'hidden',
      animate: 'visible',
      exit: 'exit',
      transition: delay ? { delay } : undefined
    };
  }, [prefersReducedMotion, delay]);
}

/**
 * Hook to get scale-in animation with reduced motion support
 */
export function useScaleInAnimation(delay?: number): MotionProps {
  const prefersReducedMotion = useReducedMotion();

  return useMemo(() => {
    if (prefersReducedMotion) {
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.2, delay }
      };
    }
    return {
      variants: scaleIn,
      initial: 'hidden',
      animate: 'visible',
      exit: 'exit',
      transition: delay ? { delay } : undefined
    };
  }, [prefersReducedMotion, delay]);
}

/**
 * Hook to get hover animation props with reduced motion support
 */
export function useHoverAnimation(type: 'card' | 'button' = 'card'): MotionProps {
  const prefersReducedMotion = useReducedMotion();

  return useMemo(() => {
    if (prefersReducedMotion) {
      return {};
    }
    return {
      variants: type === 'card' ? cardHover : buttonPress,
      initial: 'rest',
      whileHover: 'hover',
      whileTap: 'tap'
    };
  }, [prefersReducedMotion, type]);
}

/**
 * Hook to calculate stagger delays for lists
 */
export function useStaggerDelay(
  index: number,
  options?: {
    baseDelay?: number;
    staggerDelay?: number;
    maxDelay?: number;
  }
): number {
  const { baseDelay = 0, staggerDelay = 0.1, maxDelay = 1 } = options ?? {};

  return useMemo(() => {
    const calculatedDelay = baseDelay + (index * staggerDelay);
    return Math.min(calculatedDelay, maxDelay);
  }, [index, baseDelay, staggerDelay, maxDelay]);
}

/**
 * Hook to get staggered animation props for list items
 */
export function useStaggeredItemAnimation(
  index: number,
  options?: {
    baseDelay?: number;
    staggerDelay?: number;
    maxDelay?: number;
  }
): MotionProps {
  const prefersReducedMotion = useReducedMotion();
  const delay = useStaggerDelay(index, options);

  return useMemo(() => {
    if (prefersReducedMotion) {
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.2 }
      };
    }
    return {
      initial: { opacity: 0, y: 20 },
      animate: {
        opacity: 1,
        y: 0,
        transition: {
          duration: 0.5,
          delay,
          ease: [0.25, 0.46, 0.45, 0.94]
        }
      },
      exit: {
        opacity: 0,
        y: -10,
        transition: { duration: 0.3 }
      }
    };
  }, [prefersReducedMotion, delay]);
}

/**
 * Hook to get viewport animation props (animate when scrolled into view)
 */
export function useViewportAnimation(
  options?: {
    once?: boolean;
    amount?: number | 'some' | 'all';
    margin?: string;
  }
): MotionProps {
  const prefersReducedMotion = useReducedMotion();
  const { once = true, amount = 0.3, margin = '0px' } = options ?? {};

  return useMemo(() => {
    if (prefersReducedMotion) {
      return {
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once, amount, margin }
      };
    }
    return {
      variants: fadeUp,
      initial: 'hidden',
      whileInView: 'visible',
      viewport: { once, amount, margin }
    };
  }, [prefersReducedMotion, once, amount, margin]);
}

/**
 * Hook to create smooth spring transitions
 */
export function useSpringTransition(
  preset: keyof typeof springPresets = 'gentle'
) {
  return useMemo(() => springPresets[preset], [preset]);
}

/**
 * Hook to get entrance animation for pages/sections
 */
export function useEntranceAnimation(delay?: number): MotionProps {
  const prefersReducedMotion = useReducedMotion();

  return useMemo(() => {
    if (prefersReducedMotion) {
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.3 }
      };
    }
    return {
      initial: { opacity: 0, y: 20 },
      animate: {
        opacity: 1,
        y: 0,
        transition: {
          duration: 0.6,
          delay: delay ?? 0,
          ease: [0.25, 0.46, 0.45, 0.94]
        }
      }
    };
  }, [prefersReducedMotion, delay]);
}

/**
 * Hook to check if animations should be enabled
 */
export function useAnimationsEnabled(): boolean {
  const prefersReducedMotion = useReducedMotion();
  return !prefersReducedMotion;
}

/**
 * Hook to get container animation props for staggered children
 */
export function useContainerAnimation(
  staggerDelay: number = 0.1,
  delayChildren: number = 0.1
): MotionProps {
  const prefersReducedMotion = useReducedMotion();

  return useMemo(() => {
    if (prefersReducedMotion) {
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1 }
      };
    }
    return {
      initial: 'hidden',
      animate: 'visible',
      exit: 'exit',
      variants: {
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: staggerDelay,
            delayChildren
          }
        },
        exit: {
          opacity: 0,
          transition: {
            staggerChildren: staggerDelay * 0.5,
            staggerDirection: -1
          }
        }
      }
    };
  }, [prefersReducedMotion, staggerDelay, delayChildren]);
}

/**
 * Hook to get child animation props for staggered containers
 */
export function useChildAnimation(): MotionProps {
  const prefersReducedMotion = useReducedMotion();

  return useMemo(() => {
    if (prefersReducedMotion) {
      return {};
    }
    return {
      variants: fadeUp
    };
  }, [prefersReducedMotion]);
}
