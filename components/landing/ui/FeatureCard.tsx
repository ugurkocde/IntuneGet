"use client";

import { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  features?: string[];
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
        "bg-bg-surface/50 border border-white/5",
        "transition-all duration-300",
        "hover:bg-bg-elevated/50 hover:border-accent-cyan/20",
        "card-hover-dark",
        className
      )}
      whileHover={
        shouldReduceMotion
          ? {}
          : {
              y: -8,
              transition: { duration: 0.3, ease: "easeOut" },
            }
      }
    >
      {/* Glow effect on hover */}
      <div
        className={cn(
          "absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500",
          "bg-gradient-to-br from-accent-cyan/5 via-transparent to-accent-violet/5",
          "group-hover:opacity-100"
        )}
      />

      {/* Icon container */}
      <div className="relative mb-6">
        <div
          className={cn(
            "inline-flex items-center justify-center w-14 h-14 rounded-xl",
            "bg-accent-cyan/10 border border-accent-cyan/20",
            "text-accent-cyan transition-all duration-300",
            "group-hover:bg-accent-cyan/20 group-hover:border-accent-cyan/30",
            "group-hover:shadow-[0_0_30px_rgba(6,182,212,0.2)]"
          )}
        >
          {icon}
        </div>
      </div>

      {/* Content */}
      <div className="relative">
        <h3 className="text-xl font-semibold text-white mb-3 tracking-tight">
          {title}
        </h3>
        <p className="text-zinc-400 mb-4 leading-relaxed">{description}</p>

        {/* Feature list */}
        {features.length > 0 && (
          <ul className="space-y-2">
            {features.map((feature, index) => (
              <li
                key={index}
                className="flex items-center text-sm text-zinc-500"
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
