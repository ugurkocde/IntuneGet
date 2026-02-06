"use client";

import { motion, useReducedMotion } from "framer-motion";

export function SectionDivider() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="relative h-px w-full overflow-hidden">
      <motion.div
        className="absolute inset-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/30 to-transparent"
        initial={{ scaleX: 0, opacity: 0 }}
        whileInView={{ scaleX: 1, opacity: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{
          duration: shouldReduceMotion ? 0 : 0.8,
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
      />
    </div>
  );
}
