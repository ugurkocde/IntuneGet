"use client";

import { motion, useReducedMotion, Variants } from "framer-motion";
import { cn } from "@/lib/utils";

interface GradientOrbProps {
  className?: string;
  color?: "cyan" | "violet" | "mixed";
  size?: "sm" | "md" | "lg" | "xl";
  animate?: boolean;
  intensity?: "low" | "medium" | "high";
}

export function GradientOrb({
  className = "",
  color = "cyan",
  size = "md",
  animate = true,
  intensity = "medium",
}: GradientOrbProps) {
  const shouldReduceMotion = useReducedMotion();

  const sizeClasses = {
    sm: "w-48 h-48",
    md: "w-72 h-72",
    lg: "w-96 h-96",
    xl: "w-[500px] h-[500px]",
  };

  const colorClasses = {
    cyan: "from-accent-cyan/10 to-accent-cyan/2",
    violet: "from-accent-violet/10 to-accent-violet/2",
    mixed: "from-accent-cyan/8 via-accent-violet/8 to-accent-cyan/4",
  };

  // Much more subtle opacity for light theme
  const intensityOpacity = {
    low: 0.15,
    medium: 0.25,
    high: 0.35,
  };

  const baseOpacity = intensityOpacity[intensity];
  const animationVariants: Variants = {
    initial: {
      scale: 1,
      x: 0,
      y: 0,
      opacity: baseOpacity,
    },
    animate: {
      scale: [1, 1.08, 0.95, 1.04, 1],
      x: [0, 18, -14, 8, 0],
      y: [0, -20, 14, -8, 0],
      opacity: [baseOpacity, baseOpacity + 0.05, baseOpacity - 0.03, baseOpacity + 0.03, baseOpacity],
      transition: {
        duration: 10,
        repeat: Infinity,
        ease: "easeInOut" as const,
      },
    },
  };

  return (
    <motion.div
      className={cn(
        "absolute rounded-full blur-3xl pointer-events-none",
        "bg-gradient-radial",
        sizeClasses[size],
        colorClasses[color],
        className
      )}
      style={{
        opacity: animate && !shouldReduceMotion ? undefined : baseOpacity,
        background: `radial-gradient(circle, ${
          color === "cyan"
            ? "rgba(8, 145, 178, 0.15)"
            : color === "violet"
            ? "rgba(124, 58, 237, 0.12)"
            : "rgba(8, 145, 178, 0.1), rgba(124, 58, 237, 0.1)"
        } 0%, transparent 70%)`,
      }}
      initial="initial"
      animate={animate && !shouldReduceMotion ? "animate" : "initial"}
      variants={animationVariants}
    />
  );
}
