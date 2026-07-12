"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ThemeMode } from "@/types/user-settings";

/**
 * Theme context shared by PublicThemeProvider (below) and the settings-synced
 * ThemeProvider. Lives in its own module with no UserSettingsProvider import:
 * anything the root layout or marketing pages pull in must not reach
 * UserSettingsProvider -> useMicrosoftAuth -> @azure/msal-browser, or MSAL
 * lands back in every visitor's bundle.
 */
type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => Promise<void>;
};

export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined,
);

const THEME_CLASS = "dark";

// Fired whenever a provider applies a theme, so the other provider instance
// stays in sync. PublicThemeProvider lives in the persistent root layout
// while the settings-synced ThemeProvider mounts only inside the (app)
// group; without this signal the public provider's state goes stale after a
// theme change in the app and its toggle stops working until a full reload.
const THEME_CHANGE_EVENT = "intuneget:theme-change";

export function applyThemeClass(theme: ThemeMode) {
  if (typeof document === "undefined") return;

  document.documentElement.classList.toggle(THEME_CLASS, theme === "dark");
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

const PUBLIC_THEME_KEY = "intuneget-theme";

/**
 * Theme provider for pages rendered without UserSettingsProvider (marketing,
 * docs, error pages). Reads and writes the same localStorage key that the
 * boot script in app/layout.tsx and UserSettingsProvider use, so the choice
 * carries over when the visitor signs in. The app route group nests the
 * settings-synced ThemeProvider inside this one, and consumers there resolve
 * the nearest (synced) context.
 */
export function PublicThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("light");

  useEffect(() => {
    const syncFromDocument = () => {
      setThemeState(
        document.documentElement.classList.contains(THEME_CLASS)
          ? "dark"
          : "light",
      );
    };

    try {
      const stored = window.localStorage.getItem(PUBLIC_THEME_KEY);
      if (stored === "light" || stored === "dark") {
        setThemeState(stored);
      }
    } catch {
      // Storage unavailable; the boot script already applied the class and
      // toggling still works from the default state.
    }

    // Track theme changes made by the settings-synced ThemeProvider while
    // the visitor was inside the app surface.
    window.addEventListener(THEME_CHANGE_EVENT, syncFromDocument);
    return () =>
      window.removeEventListener(THEME_CHANGE_EVENT, syncFromDocument);
  }, []);

  const setTheme = async (nextTheme: ThemeMode) => {
    setThemeState(nextTheme);
    applyThemeClass(nextTheme);
    try {
      window.localStorage.setItem(PUBLIC_THEME_KEY, nextTheme);
    } catch {
      // Storage unavailable (private mode); the in-memory toggle still works.
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
}
