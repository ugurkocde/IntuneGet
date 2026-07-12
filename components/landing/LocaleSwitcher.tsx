"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useGT, useLocaleSelector } from "gt-next";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Globe, ChevronDown } from "lucide-react";

// Flags stand for countries, not languages (pt-BR vs pt, es across two
// dozen countries), so the switcher shows language codes and native names.
const localeShortCodes: Record<string, string> = {
  "en-US": "EN",
  "de": "DE",
  "fr": "FR",
  "es": "ES",
  "pt-BR": "PT",
  "ja": "JA",
  "it": "IT",
  "ko": "KO",
  "zh-CN": "ZH",
  "nl": "NL",
  "tr": "TR",
};

function getNativeLanguageName(locale: string): string | null {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? null;
  } catch {
    return null;
  }
}

const OPEN_DELAY = 150;
const CLOSE_DELAY = 200;

export function LocaleSwitcher() {
  const { locale, locales, setLocale } = useLocaleSelector();
  const t = useGT();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReduceMotion = useReducedMotion();

  const currentShort = locale ? localeShortCodes[locale] : null;

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
        aria-label={t("Change language")}
        aria-expanded={isOpen}
      >
        <Globe className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs font-medium">{currentShort ?? "EN"}</span>
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
            <div className="grid grid-cols-2 gap-1">
              {locales.map((loc) => {
                const short = localeShortCodes[loc];
                if (!short) return null;
                const nativeName = getNativeLanguageName(loc);
                const isActive = loc === locale;
                return (
                  <button
                    key={loc}
                    onClick={() => {
                      setLocale(loc);
                      setIsOpen(false);
                    }}
                    aria-current={isActive ? "true" : undefined}
                    title={nativeName ?? short}
                    className={cn(
                      "flex min-w-0 items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150",
                      isActive
                        ? "bg-accent-cyan/10 text-accent-cyan"
                        : "text-text-secondary hover:bg-overlay/[0.06] hover:text-text-primary"
                    )}
                  >
                    <span className="font-medium">{short}</span>
                    {nativeName && (
                      <span className="min-w-0 truncate text-xs text-text-muted">
                        {nativeName}
                      </span>
                    )}
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
