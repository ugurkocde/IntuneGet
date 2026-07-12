"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useGT } from "gt-next";
import { useTheme } from "@/components/providers/ThemeProvider";

export function ThemeToggle() {
  const t = useGT();
  const { theme, setTheme } = useTheme();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={
        isMounted && isDark
          ? t("Switch to light theme")
          : t("Switch to dark theme")
      }
      className="flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-overlay/5 hover:text-text-primary md:h-9 md:w-9"
    >
      {/* Render both icons and let the .dark class pick one, so server HTML
          matches the first client render regardless of stored theme */}
      <Sun className="h-4 w-4 dark:hidden" aria-hidden="true" />
      <Moon className="hidden h-4 w-4 dark:block" aria-hidden="true" />
    </button>
  );
}
