"use client";

import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";
import Image from "next/image";

interface AppIcon {
  src: string;
  alt: string;
}

interface PackageJourneyProps {
  appIcons: AppIcon[];
}

export function PackageJourney({ appIcons }: PackageJourneyProps) {
  const shouldReduceMotion = useReducedMotion();
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (shouldReduceMotion) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % appIcons.length);
    }, 2500);

    return () => clearInterval(interval);
  }, [shouldReduceMotion, appIcons.length]);

  if (shouldReduceMotion) {
    return (
      <div className="flex items-center justify-center w-16 md:w-24">
        <ArrowRight className="h-6 w-6 md:h-8 md:w-8 text-accent-cyan" />
      </div>
    );
  }

  const currentIcon = appIcons[currentIndex];

  return (
    <div className="relative w-16 md:w-24 lg:w-28 h-12 md:h-14 flex items-center justify-center overflow-hidden">
      {/* Connection line */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-accent-cyan/20 via-accent-cyan/50 to-accent-cyan/20" />

      {/* Traveling app icon */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          className="absolute"
          initial={{ x: "-100%", opacity: 0 }}
          animate={{ x: "100%", opacity: [0, 1, 1, 0] }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 2.0,
            times: [0, 0.2, 0.8, 1],
            ease: "easeInOut",
          }}
        >
          <Image
            src={currentIcon.src}
            alt={currentIcon.alt}
            width={32}
            height={32}
            className="w-6 h-6 md:w-7 md:h-7 drop-shadow-[0_0_10px_rgba(6,182,212,0.6)]"
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
