"use client";

import { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface BadgeProps {
  children: ReactNode;
  icon?: ReactNode;
  variant?: "cyan" | "violet" | "success" | "warning" | "dark";
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
    cyan: "bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan",
    violet: "bg-accent-violet/10 border-accent-violet/30 text-accent-violet",
    success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-600",
    warning: "bg-amber-500/10 border-amber-500/30 text-amber-600",
    dark: "bg-stone-900 border-stone-800 text-white",
  };

  const hoverStyles = {
    cyan: "hover:bg-accent-cyan/15 hover:border-accent-cyan/40",
    violet: "hover:bg-accent-violet/15 hover:border-accent-violet/40",
    success: "hover:bg-emerald-500/15 hover:border-emerald-500/40",
    warning: "hover:bg-amber-500/15 hover:border-amber-500/40",
    dark: "hover:bg-stone-800",
  };

  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2 rounded-full",
        "border font-mono text-xs tracking-wide uppercase",
        "transition-all duration-300",
        variantStyles[variant],
        hoverStyles[variant],
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
