"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ConnectorLineProps {
  className?: string;
  color?: "cyan" | "violet" | "gradient";
  delay?: number;
}

export function ConnectorLine({
  className = "",
  color = "cyan",
  delay = 0,
}: ConnectorLineProps) {
  const shouldReduceMotion = useReducedMotion();

  const colorStyles = {
    cyan: {
      line: "from-accent-cyan/0 via-accent-cyan/30 to-accent-cyan/0",
      glow: "rgba(8, 145, 178, 0.4)",
    },
    violet: {
      line: "from-accent-violet/0 via-accent-violet/30 to-accent-violet/0",
      glow: "rgba(124, 58, 237, 0.4)",
    },
    gradient: {
      line: "from-accent-cyan/0 via-accent-violet/30 to-accent-cyan/0",
      glow: "rgba(124, 58, 237, 0.3)",
    },
  };

  return (
    <div className={cn("relative h-px w-full overflow-hidden", className)}>
      {/* Base line */}
      <motion.div
        className={cn(
          "absolute inset-0 bg-gradient-to-r",
          colorStyles[color].line
        )}
        initial={{ scaleX: 0, originX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{
          duration: shouldReduceMotion ? 0 : 0.8,
          delay: shouldReduceMotion ? 0 : delay,
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
      />

      {/* Glow pulse that travels along the line */}
      {!shouldReduceMotion && (
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 w-16 h-2 rounded-full blur-sm"
          style={{
            background: `radial-gradient(ellipse, ${colorStyles[color].glow}, transparent)`,
          }}
          initial={{ left: "-10%", opacity: 0 }}
          whileInView={{
            left: ["0%", "100%"],
            opacity: [0, 1, 1, 0],
          }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{
            duration: 1.5,
            delay: delay + 0.5,
            ease: "easeInOut",
            times: [0, 0.1, 0.9, 1],
          }}
        />
      )}
    </div>
  );
}
