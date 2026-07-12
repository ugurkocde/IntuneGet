"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, CircleHelp, FileClock, Newspaper, Tag } from "lucide-react";
import { T } from "gt-next";

const OPEN_DELAY = 150;
const CLOSE_DELAY = 200;

const resourceLinks = [
  {
    href: "/pricing",
    label: "Pricing",
    description: "Simple and transparent",
    icon: Tag,
  },
  {
    href: "/#faq",
    label: "FAQ",
    description: "Common questions answered",
    icon: CircleHelp,
  },
  {
    href: "/blog",
    label: "Blog",
    description: "Guides and product stories",
    icon: Newspaper,
  },
  {
    href: "/changelog",
    label: "Changelog",
    description: "See what is new",
    icon: FileClock,
  },
];

export function ResourcesDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReduceMotion = useReducedMotion();

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearTimers();
    openTimer.current = setTimeout(() => setIsOpen(true), OPEN_DELAY);
  }, [clearTimers]);

  const handleMouseLeave = useCallback(() => {
    clearTimers();
    closeTimer.current = setTimeout(() => setIsOpen(false), CLOSE_DELAY);
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener("mousedown", handlePointerDown);
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="group relative inline-flex items-center gap-1 whitespace-nowrap rounded-sm text-sm font-medium text-text-secondary transition-colors duration-200 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-4 focus-visible:ring-offset-bg-deepest"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span><T>Resources</T></span>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </motion.span>
        <span className="absolute -bottom-1 left-0 h-0.5 w-0 bg-accent-cyan transition-all duration-300 group-hover:w-full" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="absolute right-0 top-full z-50 mt-3 w-72 rounded-xl border border-overlay/[0.06] bg-bg-elevated/95 p-2 shadow-soft-lg backdrop-blur-xl"
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
          >
            {resourceLinks.map((link) => {
              const Icon = link.icon;

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-overlay/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                  <span>
                    <span className="block text-sm font-medium text-text-primary"><T>{link.label}</T></span>
                    <span className="block text-xs text-text-muted"><T>{link.description}</T></span>
                  </span>
                </Link>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
