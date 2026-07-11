"use client";

import { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { springPresets } from "@/lib/animations/variants";

interface FeatureCardProps {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  features?: ReactNode[];
  className?: string;
}

export function FeatureCard({
  icon,
  title,
  description,
  features = [],
  className = "",
}: FeatureCardProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className={cn(
        "group relative flex flex-col p-6 md:p-8 rounded-2xl",
        "bg-bg-elevated border border-overlay/10 hover:border-accent-cyan/20",
        "shadow-card hover:shadow-card-hover",
        "transition-all duration-300",
        className
      )}
      whileHover={
        shouldReduceMotion
          ? {}
          : {
              y: -8,
              boxShadow: "0 0 30px rgba(8, 145, 178, 0.15), 0 0 60px rgba(8, 145, 178, 0.1)",
              transition: springPresets.snappy,
            }
      }
      whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
    >
      {/* Icon container */}
      <div className="relative mb-6">
        <div
          className={cn(
            "inline-flex items-center justify-center w-14 h-14 rounded-xl",
            "bg-accent-cyan/10 border border-accent-cyan/20",
            "text-accent-cyan transition-all duration-300",
            "group-hover:bg-accent-cyan/15 group-hover:border-accent-cyan/30"
          )}
        >
          {icon}
        </div>
      </div>

      {/* Content */}
      <div className="relative">
        <h3 className="text-xl font-semibold text-text-primary mb-3 tracking-tight">
          {title}
        </h3>
        <p className="text-text-secondary mb-4 leading-relaxed">{description}</p>

        {/* Feature list */}
        {features.length > 0 && (
          <ul className="space-y-2">
            {features.map((feature, index) => (
              <li
                key={index}
                className="flex items-center text-sm text-text-muted"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mr-3 flex-shrink-0" />
                {feature}
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  );
}
