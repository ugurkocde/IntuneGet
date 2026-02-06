"use client";

import { motion, useReducedMotion, Variants } from "framer-motion";

interface TextRevealProps {
  text: string;
  className?: string;
  delay?: number;
  staggerDelay?: number;
  once?: boolean;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  /** If true, animate on mount instead of on scroll into view */
  animateOnMount?: boolean;
}

export function TextReveal({
  text,
  className = "",
  delay = 0,
  staggerDelay = 0.03,
  once = true,
  as: Component = "span",
  animateOnMount = false,
}: TextRevealProps) {
  const shouldReduceMotion = useReducedMotion();
  const words = text.split(" ");

  const containerVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: shouldReduceMotion ? 0 : staggerDelay,
        delayChildren: shouldReduceMotion ? 0 : delay,
      },
    },
  };

  const wordVariants: Variants = {
    hidden: {
      opacity: 0,
      y: shouldReduceMotion ? 0 : 20,
      filter: shouldReduceMotion ? "blur(0px)" : "blur(4px)",
    },
    visible: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: {
        duration: shouldReduceMotion ? 0 : 0.4,
        ease: [0.25, 0.46, 0.45, 0.94],
      },
    },
  };

  const MotionComponent = motion[Component];

  const motionProps = animateOnMount
    ? { initial: "hidden" as const, animate: "visible" as const }
    : { initial: "hidden" as const, whileInView: "visible" as const, viewport: { once, amount: 0.5 } };

  return (
    <MotionComponent
      className={className}
      {...motionProps}
      variants={containerVariants}
      aria-label={text}
    >
      {words.map((word, index) => (
        <motion.span
          key={`${word}-${index}`}
          className="inline-block"
          variants={wordVariants}
        >
          {word}
          {index < words.length - 1 && "\u00A0"}
        </motion.span>
      ))}
    </MotionComponent>
  );
}
