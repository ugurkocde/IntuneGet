"use client";

import { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { springPresets } from "@/lib/animations/variants";

interface CapabilityCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  features?: string[];
  color: "cyan" | "violet" | "gradient";
  className?: string;
}

export function CapabilityCard({
  icon,
  title,
  description,
  features = [],
  color,
  className = "",
}: CapabilityCardProps) {
  const shouldReduceMotion = useReducedMotion();

  const colorStyles = {
    cyan: {
      iconBg: "bg-accent-cyan/10",
      iconBorder: "border-accent-cyan/20",
      iconText: "text-accent-cyan",
      hoverIconBg: "group-hover:bg-accent-cyan/15",
      hoverIconBorder: "group-hover:border-accent-cyan/30",
      bullet: "bg-accent-cyan",
    },
    violet: {
      iconBg: "bg-accent-violet/10",
      iconBorder: "border-accent-violet/20",
      iconText: "text-accent-violet",
      hoverIconBg: "group-hover:bg-accent-violet/15",
      hoverIconBorder: "group-hover:border-accent-violet/30",
      bullet: "bg-accent-violet",
    },
    gradient: {
      iconBg: "bg-gradient-to-br from-accent-cyan/10 to-accent-violet/10",
      iconBorder: "border-accent-cyan/20",
      iconText: "text-accent-cyan",
      hoverIconBg: "group-hover:bg-gradient-to-br group-hover:from-accent-cyan/15 group-hover:to-accent-violet/15",
      hoverIconBorder: "group-hover:border-accent-violet/30",
      bullet: "bg-gradient-to-r from-accent-cyan to-accent-violet",
    },
  };

  const styles = colorStyles[color];

  const glowColors = {
    cyan: "0 0 30px rgba(34, 211, 238, 0.15), 0 0 60px rgba(34, 211, 238, 0.1)",
    violet: "0 0 30px rgba(124, 58, 237, 0.15), 0 0 60px rgba(124, 58, 237, 0.1)",
    gradient: "0 0 30px rgba(34, 211, 238, 0.12), 0 0 60px rgba(124, 58, 237, 0.08)",
  };

  return (
    <motion.div
      className={cn(
        "group relative flex flex-col p-5 md:p-6 rounded-xl",
        "bg-white border border-stone-200/60",
        "shadow-card hover:shadow-card-hover",
        "transition-shadow duration-300",
        className
      )}
      whileHover={
        shouldReduceMotion
          ? {}
          : {
              y: -8,
              boxShadow: glowColors[color],
              transition: springPresets.snappy,
            }
      }
      whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
    >
      {/* Icon container */}
      <div className="relative mb-4">
        <motion.div
          className={cn(
            "inline-flex items-center justify-center w-12 h-12 rounded-lg",
            styles.iconBg,
            "border",
            styles.iconBorder,
            styles.iconText,
            "transition-all duration-300",
            styles.hoverIconBg,
            styles.hoverIconBorder
          )}
          whileHover={
            shouldReduceMotion
              ? {}
              : {
                  scale: 1.05,
                  transition: { duration: 0.2 },
                }
          }
        >
          {icon}
        </motion.div>
      </div>

      {/* Content */}
      <div className="relative flex-1">
        <h3 className="text-base font-semibold text-stone-900 mb-2 tracking-tight">
          {title}
        </h3>
        <p className="text-sm text-stone-600 leading-relaxed mb-3">
          {description}
        </p>

        {/* Feature list with staggered reveal on hover */}
        {features.length > 0 && (
          <ul className="space-y-1.5">
            {features.map((feature, index) => (
              <motion.li
                key={index}
                className="flex items-center text-xs text-stone-500"
                initial={{ opacity: 0.7 }}
                whileHover={{ opacity: 1 }}
              >
                <span
                  className={cn(
                    "w-1 h-1 rounded-full mr-2 flex-shrink-0",
                    styles.bullet
                  )}
                />
                {feature}
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  );
}
