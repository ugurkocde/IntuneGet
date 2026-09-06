"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useId,
  type ReactNode,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  navigationItemClassName,
  navigationUnderlineClassName,
} from "./navigation-styles";

export function NavigationDropdown({
  label,
  panelClassName,
  children,
}: {
  label: ReactNode;
  panelClassName: string;
  children: (close: () => void) => ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const reduceMotion = useReducedMotion();
  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    clearTimer();
    setIsOpen(false);
  }, [clearTimer]);
  useEffect(() => clearTimer, [clearTimer]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (container.current?.contains(document.activeElement))
        trigger.current?.focus();
      close();
    };
    if (isOpen) {
      document.addEventListener("pointerdown", outside);
      document.addEventListener("keydown", escape);
    }
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [isOpen, close]);

  return (
    <div
      ref={container}
      className="relative flex h-10 items-center"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        clearTimer();
        timer.current = setTimeout(() => setIsOpen(true), 150);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        clearTimer();
        timer.current = setTimeout(() => setIsOpen(false), 200);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={navigationItemClassName}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={() => {
          clearTimer();
          setIsOpen((open) => !open);
        }}
      >
        <span>{label}</span>
        <motion.span
          className="inline-flex"
          aria-hidden="true"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </motion.span>
        <span
          aria-hidden="true"
          className={cn(navigationUnderlineClassName, isOpen && "scale-x-100")}
        />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            id={panelId}
            className={cn(
              "absolute top-full z-50 mt-3 rounded-xl border border-overlay/[0.06] bg-bg-elevated/95 shadow-soft-lg backdrop-blur-xl",
              panelClassName,
            )}
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{
              duration: reduceMotion ? 0 : 0.2,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
          >
            {children(close)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
