"use client";

import { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface BadgeProps {
  children: ReactNode;
  icon?: ReactNode;
  variant?: "cyan" | "violet" | "success" | "warning";
  className?: string;
  animated?: boolean;
}

export function Badge({
  children,
  icon,
  variant = "cyan",
  className = "",
  animated = true,
}: BadgeProps) {
  const shouldReduceMotion = useReducedMotion();

  const variantStyles = {
    cyan: "bg-accent-cyan/10 border-accent-cyan/20 text-accent-cyan-bright",
    violet: "bg-accent-violet/10 border-accent-violet/20 text-accent-violet-bright",
    success: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    warning: "bg-amber-500/10 border-amber-500/20 text-amber-400",
  };

  const glowStyles = {
    cyan: "hover:shadow-[0_0_20px_rgba(6,182,212,0.2)]",
    violet: "hover:shadow-[0_0_20px_rgba(139,92,246,0.2)]",
    success: "hover:shadow-[0_0_20px_rgba(16,185,129,0.2)]",
    warning: "hover:shadow-[0_0_20px_rgba(245,158,11,0.2)]",
  };

  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2 rounded-full",
        "border font-mono text-xs tracking-wide uppercase",
        "transition-all duration-300",
        variantStyles[variant],
        glowStyles[variant],
        className
      )}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </span>
  );

  if (!animated || shouldReduceMotion) {
    return content;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    >
      {content}
    </motion.div>
  );
}
