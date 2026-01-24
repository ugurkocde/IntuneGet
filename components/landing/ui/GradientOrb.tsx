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
    cyan: "from-accent-cyan/30 to-accent-cyan/5",
    violet: "from-accent-violet/30 to-accent-violet/5",
    mixed: "from-accent-cyan/20 via-accent-violet/20 to-accent-cyan/10",
  };

  const intensityOpacity = {
    low: 0.3,
    medium: 0.5,
    high: 0.7,
  };

  const animationVariants: Variants = {
    initial: {
      scale: 1,
      x: 0,
      y: 0,
    },
    animate: {
      scale: [1, 1.1, 0.95, 1.05, 1],
      x: [0, 20, -15, 10, 0],
      y: [0, -25, 15, -10, 0],
      transition: {
        duration: 8,
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
        opacity: intensityOpacity[intensity],
        background: `radial-gradient(circle, ${
          color === "cyan"
            ? "rgba(6, 182, 212, 0.4)"
            : color === "violet"
            ? "rgba(139, 92, 246, 0.4)"
            : "rgba(6, 182, 212, 0.3), rgba(139, 92, 246, 0.3)"
        } 0%, transparent 70%)`,
      }}
      initial="initial"
      animate={animate && !shouldReduceMotion ? "animate" : "initial"}
      variants={animationVariants}
    />
  );
}
