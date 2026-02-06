"use client";

import { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CategoryHeader } from "./CategoryHeader";
import { ConnectorLine } from "../animations/ConnectorLine";

interface CategoryRowProps {
  title: string;
  color: "cyan" | "violet" | "gradient";
  children: ReactNode;
  className?: string;
  delay?: number;
}

export function CategoryRow({
  title,
  color,
  children,
  className = "",
  delay = 0,
}: CategoryRowProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className={cn("space-y-5", className)}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.5,
        delay: shouldReduceMotion ? 0 : delay,
      }}
    >
      {/* Category header with connector line */}
      <div className="flex items-center gap-4">
        <CategoryHeader title={title} color={color} delay={delay} />
        <div className="flex-1 hidden sm:block">
          <ConnectorLine color={color} delay={delay + 0.2} />
        </div>
      </div>

      {/* Cards container */}
      <motion.div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={{
          hidden: {},
          visible: {
            transition: {
              staggerChildren: shouldReduceMotion ? 0 : 0.1,
              delayChildren: shouldReduceMotion ? 0 : delay + 0.3,
            },
          },
        }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

// Wrapper for individual cards within CategoryRow
export function CategoryRowItem({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      variants={{
        hidden: {
          opacity: 0,
          y: shouldReduceMotion ? 0 : 20,
        },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            duration: shouldReduceMotion ? 0 : 0.5,
            ease: [0.25, 0.46, 0.45, 0.94],
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
