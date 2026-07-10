"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useLocaleSelector } from "gt-next";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Globe, ChevronDown } from "lucide-react";

const localeFlags: Record<string, { flag: string; short: string }> = {
  "en-US": { flag: "\u{1F1FA}\u{1F1F8}", short: "EN" },
  "de":    { flag: "\u{1F1E9}\u{1F1EA}", short: "DE" },
  "fr":    { flag: "\u{1F1EB}\u{1F1F7}", short: "FR" },
  "es":    { flag: "\u{1F1EA}\u{1F1F8}", short: "ES" },
  "pt-BR": { flag: "\u{1F1E7}\u{1F1F7}", short: "BR" },
  "ja":    { flag: "\u{1F1EF}\u{1F1F5}", short: "JA" },
  "it":    { flag: "\u{1F1EE}\u{1F1F9}", short: "IT" },
  "ko":    { flag: "\u{1F1F0}\u{1F1F7}", short: "KO" },
  "zh-CN": { flag: "\u{1F1E8}\u{1F1F3}", short: "CN" },
  "nl":    { flag: "\u{1F1F3}\u{1F1F1}", short: "NL" },
  "tr":    { flag: "\u{1F1F9}\u{1F1F7}", short: "TR" },
};

const OPEN_DELAY = 150;
const CLOSE_DELAY = 200;

export function LocaleSwitcher() {
  const { locale, locales, setLocale } = useLocaleSelector();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReduceMotion = useReducedMotion();

  const currentFlag = locale ? localeFlags[locale] : null;

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

  const handleClose = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, handleClose]);

  useEffect(() => {
    return clearTimers;
  }, [clearTimers]);

  if (!locales?.length) return null;

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors duration-200"
        aria-label="Change language"
        aria-expanded={isOpen}
      >
        {currentFlag ? (
          <span className="text-base leading-none">{currentFlag.flag}</span>
        ) : (
          <Globe className="h-4 w-4" />
        )}
        <span className="text-xs font-medium">{currentFlag?.short ?? "EN"}</span>
        <ChevronDown className={cn(
          "h-3 w-3 transition-transform duration-200",
          isOpen && "rotate-180"
        )} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="absolute right-0 z-50 mt-3 w-[240px] bg-bg-elevated/95 backdrop-blur-xl border border-overlay/[0.06] rounded-xl shadow-soft-lg p-2"
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
          >
            <div className="grid grid-cols-3 gap-1">
              {locales.map((loc) => {
                const info = localeFlags[loc];
                if (!info) return null;
                const isActive = loc === locale;
                return (
                  <button
                    key={loc}
                    onClick={() => {
                      setLocale(loc);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150",
                      isActive
                        ? "bg-accent-cyan/10 text-accent-cyan"
                        : "text-text-secondary hover:bg-overlay/[0.06] hover:text-text-primary"
                    )}
                  >
                    <span className="text-base leading-none">{info.flag}</span>
                    <span className="font-medium">{info.short}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
