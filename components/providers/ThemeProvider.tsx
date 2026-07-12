"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useUserSettings } from "@/components/providers/UserSettingsProvider";
import {
  ThemeContext,
  applyThemeClass,
} from "@/components/providers/theme-context";
import type { ThemeMode } from "@/types/user-settings";

/**
 * Settings-synced theme provider for the app route group: theme changes
 * persist to the signed-in user's account via UserSettingsProvider. Public
 * pages use PublicThemeProvider from theme-context.tsx instead; keep this
 * file out of any public-page import chain because useUserSettings pulls
 * MSAL into the bundle.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, setTheme: persistTheme } = useUserSettings();
  const [theme, setThemeState] = useState<ThemeMode>(settings.theme);

  useEffect(() => {
    setThemeState(settings.theme);
    applyThemeClass(settings.theme);
  }, [settings.theme]);

  const setTheme = async (nextTheme: ThemeMode) => {
    setThemeState(nextTheme);
    applyThemeClass(nextTheme);
    await persistTheme(nextTheme);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
