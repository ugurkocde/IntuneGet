"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion, useSpring, useTransform, motion } from "framer-motion";
import { useLocale } from "gt-next";

interface CountUpProps {
  end: number;
  duration?: number;
  delay?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  decimals?: number;
}

export function CountUp({
  end,
  duration = 2,
  delay = 0,
  prefix = "",
  suffix = "",
  className = "",
  decimals = 0,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const shouldReduceMotion = useReducedMotion();
  // gt-next locale is identical on server and client; the browser's implicit
  // locale is not, and a bare toLocaleString() breaks hydration for non-en users.
  // An empty locale string would make toLocaleString throw a RangeError.
  const localeTag = useLocale() || undefined;
  // Server HTML and the first client render show the real final value so
  // crawlers see actual numbers; the animated 0-to-end swap only happens
  // after mount, which keeps hydration deterministic.
  const [isMounted, setIsMounted] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);

  const formatValue = (value: number) => {
    if (decimals > 0) {
      return value.toFixed(decimals);
    }
    return Math.round(value).toLocaleString(localeTag);
  };

  const springValue = useSpring(0, {
    duration: duration * 1000,
    bounce: 0,
  });

  const displayValue = useTransform(springValue, formatValue);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (isMounted && isInView && !shouldReduceMotion && !hasAnimated) {
      const timer = setTimeout(() => {
        springValue.set(end);
        setHasAnimated(true);
      }, delay * 1000);

      return () => clearTimeout(timer);
    }
  }, [isMounted, isInView, shouldReduceMotion, hasAnimated, springValue, end, delay]);

  const showAnimatedValue = isMounted && !shouldReduceMotion;

  return (
    <span ref={ref} className={className}>
      {prefix}
      {showAnimatedValue ? (
        <motion.span className="tabular-nums">{displayValue}</motion.span>
      ) : (
        <span className="tabular-nums">{formatValue(end)}</span>
      )}
      {suffix}
    </span>
  );
}
