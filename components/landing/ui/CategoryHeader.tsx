"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CategoryHeaderProps {
  title: string;
  color: "cyan" | "violet" | "gradient";
  className?: string;
  delay?: number;
}

export function CategoryHeader({
  title,
  color,
  className = "",
  delay = 0,
}: CategoryHeaderProps) {
  const shouldReduceMotion = useReducedMotion();

  const colorStyles = {
    cyan: {
      text: "text-accent-cyan",
      border: "border-accent-cyan/30",
      bg: "bg-accent-cyan/10",
      shadow: "shadow-soft",
    },
    violet: {
      text: "text-accent-violet",
      border: "border-accent-violet/30",
      bg: "bg-accent-violet/10",
      shadow: "shadow-soft",
    },
    gradient: {
      text: "bg-gradient-to-r from-accent-cyan to-accent-violet bg-clip-text text-transparent",
      border: "border-accent-violet/30",
      bg: "bg-gradient-to-r from-accent-cyan/10 to-accent-violet/10",
      shadow: "shadow-soft",
    },
  };

  const characters = title.split("");

  return (
    <motion.div
      className={cn(
        "inline-flex items-center gap-3 px-4 py-2 rounded-full border",
        colorStyles[color].border,
        colorStyles[color].bg,
        colorStyles[color].shadow,
        className
      )}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.5,
        delay: shouldReduceMotion ? 0 : delay,
      }}
    >
      {/* Terminal prompt indicator */}
      <span className={cn("font-mono text-xs", colorStyles[color].text)}>
        {"//"}
      </span>

      {/* Typing effect for title */}
      <span className={cn("font-mono text-sm font-medium tracking-wider uppercase", colorStyles[color].text)}>
        {shouldReduceMotion ? (
          title
        ) : (
          characters.map((char, index) => (
            <motion.span
              key={index}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.05,
                delay: delay + 0.3 + index * 0.03,
              }}
            >
              {char}
            </motion.span>
          ))
        )}
      </span>
    </motion.div>
  );
}
