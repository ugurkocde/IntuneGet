'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion, animate } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AnimatedCounterProps {
  /** Target value to count to */
  value: number;
  /** Duration of the animation in seconds */
  duration?: number;
  /** Decimal places to show */
  decimals?: number;
  /** Prefix to show before the number */
  prefix?: string;
  /** Suffix to show after the number */
  suffix?: string;
  /** CSS class for the container */
  className?: string;
  /** Format number with locale separators */
  formatNumber?: boolean;
  /** Start animation when in viewport */
  animateOnView?: boolean;
  /** Delay before animation starts */
  delay?: number;
  /** Easing function */
  easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
}

const easingFunctions = {
  linear: (t: number) => t,
  easeIn: (t: number) => t * t,
  easeOut: (t: number) => 1 - (1 - t) * (1 - t),
  easeInOut: (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
};

export function AnimatedCounter({
  value,
  duration = 1.5,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
  formatNumber = true,
  animateOnView = true,
  delay = 0,
  easing = 'easeOut'
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const prefersReducedMotion = useReducedMotion();
  const [displayValue, setDisplayValue] = useState(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    // Skip animation if reduced motion is preferred
    if (prefersReducedMotion) {
      setDisplayValue(value);
      return;
    }

    // Don't animate if not in view yet (when animateOnView is true)
    if (animateOnView && !isInView) {
      return;
    }

    // Don't re-animate if already done
    if (hasAnimated.current && animateOnView) {
      return;
    }

    hasAnimated.current = true;

    // Delay the animation if specified
    const timeoutId = setTimeout(() => {
      const controls = animate(0, value, {
        duration,
        ease: easing,
        onUpdate: (latest) => {
          setDisplayValue(latest);
        }
      });

      return () => controls.stop();
    }, delay * 1000);

    return () => clearTimeout(timeoutId);
  }, [value, duration, isInView, animateOnView, prefersReducedMotion, delay, easing]);

  // Update value if it changes after initial animation
  useEffect(() => {
    if (hasAnimated.current && value !== displayValue) {
      // Animate to new value
      if (prefersReducedMotion) {
        setDisplayValue(value);
        return;
      }

      const controls = animate(displayValue, value, {
        duration: duration * 0.5,
        ease: easing,
        onUpdate: (latest) => {
          setDisplayValue(latest);
        }
      });

      return () => controls.stop();
    }
  }, [value]);

  const formattedValue = formatNumber
    ? displayValue.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      })
    : displayValue.toFixed(decimals);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {prefix}
      {formattedValue}
      {suffix}
    </span>
  );
}

// Compact version for large numbers (1.2K, 3.5M, etc.)
interface CompactCounterProps extends Omit<AnimatedCounterProps, 'formatNumber' | 'decimals'> {
  /** Number of significant digits */
  precision?: number;
}

export function CompactCounter({
  value,
  precision = 1,
  ...props
}: CompactCounterProps) {
  const formatCompact = (num: number): { value: number; suffix: string } => {
    if (num >= 1_000_000_000) {
      return { value: num / 1_000_000_000, suffix: 'B' };
    }
    if (num >= 1_000_000) {
      return { value: num / 1_000_000, suffix: 'M' };
    }
    if (num >= 1_000) {
      return { value: num / 1_000, suffix: 'K' };
    }
    return { value: num, suffix: '' };
  };

  const { value: compactValue, suffix } = formatCompact(value);

  return (
    <AnimatedCounter
      {...props}
      value={compactValue}
      decimals={suffix ? precision : 0}
      suffix={suffix + (props.suffix ?? '')}
      formatNumber={false}
    />
  );
}

// Percentage counter
interface PercentageCounterProps extends Omit<AnimatedCounterProps, 'suffix' | 'formatNumber'> {
  /** Show the percentage sign */
  showPercent?: boolean;
}

export function PercentageCounter({
  showPercent = true,
  decimals = 0,
  ...props
}: PercentageCounterProps) {
  return (
    <AnimatedCounter
      {...props}
      decimals={decimals}
      suffix={showPercent ? '%' : ''}
      formatNumber={false}
    />
  );
}
