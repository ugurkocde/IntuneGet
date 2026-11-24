"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMicrosoftAuth } from "@/hooks/useMicrosoftAuth";
import { useCartStore } from "@/stores/cart-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { getUserSettings, patchUserSettings } from "@/lib/user-settings";
import {
  DEFAULT_USER_SETTINGS,
  type PackageDefaults,
  type StoredUserSettings,
  type ThemeMode,
  type ViewMode,
  type UserSettings,
  type UserSettingsUpdate,
} from "@/types/user-settings";

type UserSettingsContextValue = {
  settings: UserSettings;
  isLoading: boolean;
  hasStoredSettings: boolean;
  isSaving: boolean;
  syncError: string | null;
  setTheme: (theme: ThemeMode) => Promise<void>;
  setSidebarCollapsed: (collapsed: boolean) => Promise<void>;
  setSelectedTenantId: (tenantId: string | null) => Promise<void>;
  setCartAutoOpenOnAdd: (enabled: boolean) => Promise<void>;
  setViewMode: (mode: ViewMode) => Promise<void>;
  setQuickStartDismissed: (dismissed: boolean) => Promise<void>;
  setOnboardingCompleted: (completed: boolean) => Promise<void>;
  setCarryOverAssignments: (enabled: boolean) => Promise<void>;
  setSupersedePreviousApp: (enabled: boolean) => Promise<void>;
  /** Server only defaults for the signed in account, null until loaded. */
  packageDefaults: PackageDefaults | null;
  packageDefaultsStatus: 'loading' | 'loaded' | 'error';
  /** Changes whenever the signed in account changes, including sign out. */
  packageDefaultsAccountScope: number;
  /** Saves or clears the defaults. Throws when the server cannot store them. */
  savePackageDefaults: (defaults: PackageDefaults | null) => Promise<void>;
};

type ScopedPackageDefaults = { generation: number; value: PackageDefaults | null; status: 'loaded' | 'error' };

/** Splits server only values off so they never reach local storage. */
function splitServerSettings(settings: StoredUserSettings | UserSettings): {
  settings: UserSettings;
  packageDefaults: PackageDefaults | null;
} {
  const { packageDefaults, ...rest } = settings as StoredUserSettings;
  return { settings: rest, packageDefaults: packageDefaults ?? null };
}

const UserSettingsContext = createContext<UserSettingsContextValue | null>(null);

const THEME_KEY = "intuneget-theme";
const SIDEBAR_COLLAPSE_KEY = "intuneget-sidebar-collapsed";
const CART_KEY = "intuneget-cart";
const SELECTED_TENANT_KEY = "msp_selected_tenant_id";
const VIEW_MODE_KEY = "intuneget-view-mode";
const QUICK_START_DISMISSED_KEY = "intuneget-quick-start-dismissed";
const ONBOARDING_COMPLETED_KEY = "intuneget-onboarding-completed";
const CARRY_OVER_ASSIGNMENTS_KEY = "intuneget-carry-over-assignments";
const SUPERSEDE_PREVIOUS_APP_KEY = "intuneget-supersede-previous-app";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark";
}

function readBooleanStorageValue(key: string): boolean | null {
  if (typeof window === "undefined") return null;

  const value = window.localStorage.getItem(key);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "boolean") {
        return parsed;
      }
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        if (
          typeof (parsed as { isCollapsed?: unknown }).isCollapsed === "boolean"
        ) {
          return (parsed as { isCollapsed: boolean }).isCollapsed;
        }
        if (typeof (parsed as { state?: unknown }).state === "object" && (parsed as { state: unknown }).state !== null) {
          const state = (parsed as { state: { isCollapsed?: unknown } }).state;
          if (typeof state?.isCollapsed === "boolean") {
            return state.isCollapsed;
          }
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

function readLegacyCartAutoOpenOnAdd(): boolean | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(CART_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed.autoOpenOnAdd === "boolean"
      ? parsed.autoOpenOnAdd
      : null;
  } catch {
    return null;
  }
}

function readLegacyUserSettings(): {
  settings: UserSettings;
  hasTheme: boolean;
  hasSidebarCollapsed: boolean;
  hasSelectedTenantId: boolean;
  hasCartAutoOpenOnAdd: boolean;
} {
  if (typeof window === "undefined") {
    return {
      settings: DEFAULT_USER_SETTINGS,
      hasTheme: false,
      hasSidebarCollapsed: false,
      hasSelectedTenantId: false,
      hasCartAutoOpenOnAdd: false,
    };
  }

  const themeValue = window.localStorage.getItem(THEME_KEY);
  const sidebarValue = readBooleanStorageValue(SIDEBAR_COLLAPSE_KEY);
  const selectedTenant = window.localStorage.getItem(SELECTED_TENANT_KEY);
  const cartAutoOpenOnAdd = readLegacyCartAutoOpenOnAdd();
  const viewModeValue = window.localStorage.getItem(VIEW_MODE_KEY);
  const quickStartDismissedValue = readBooleanStorageValue(QUICK_START_DISMISSED_KEY);
  const onboardingCompletedValue = readBooleanStorageValue(ONBOARDING_COMPLETED_KEY);
  const carryOverAssignmentsValue = readBooleanStorageValue(CARRY_OVER_ASSIGNMENTS_KEY);
  const supersedePreviousAppValue = readBooleanStorageValue(SUPERSEDE_PREVIOUS_APP_KEY);

  const hasTheme = isThemeMode(themeValue);
  const hasSidebarCollapsed = sidebarValue !== null;
  const hasSelectedTenantId = !!selectedTenant;
  const hasCartAutoOpenOnAdd = cartAutoOpenOnAdd !== null;
  const hasViewMode = viewModeValue === "grid" || viewModeValue === "list";
  const hasQuickStartDismissed = quickStartDismissedValue !== null;
  const hasOnboardingCompleted = onboardingCompletedValue !== null;
  const hasCarryOverAssignments = carryOverAssignmentsValue !== null;
  const hasSupersedePreviousApp = supersedePreviousAppValue !== null;

  return {
    settings: {
      ...DEFAULT_USER_SETTINGS,
      theme: hasTheme ? themeValue : DEFAULT_USER_SETTINGS.theme,
      ...(hasSidebarCollapsed ? { sidebarCollapsed: sidebarValue === true } : {}),
      ...(hasSelectedTenantId ? { selectedTenantId: selectedTenant } : {}),
      ...(hasCartAutoOpenOnAdd ? { cartAutoOpenOnAdd } : {}),
      ...(hasViewMode ? { viewMode: viewModeValue as "grid" | "list" } : {}),
      ...(hasQuickStartDismissed ? { quickStartDismissed: quickStartDismissedValue === true } : {}),
      ...(hasOnboardingCompleted ? { onboardingCompleted: onboardingCompletedValue === true } : {}),
      ...(hasCarryOverAssignments ? { carryOverAssignments: carryOverAssignmentsValue === true } : {}),
      ...(hasSupersedePreviousApp ? { supersedePreviousApp: supersedePreviousAppValue === true } : {}),
    },
    hasTheme,
    hasSidebarCollapsed,
    hasSelectedTenantId,
    hasCartAutoOpenOnAdd,
  };
}

function writeBooleanSetting(key: string, value: boolean) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Ignore local storage failures. Keep memory/server state for persistence.
  }
}

function writeStringSetting(key: string, value: string | null) {
  if (typeof window === "undefined") return;

  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore local storage failures. Keep memory/server state for persistence.
  }
}

function writeCartAutoOpenSetting(enabled: boolean) {
  if (typeof window === "undefined") return;

  try {
    const raw = window.localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const current = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};

    window.localStorage.setItem(
      CART_KEY,
      JSON.stringify({
        ...current,
        autoOpenOnAdd: enabled,
      })
    );
  } catch {
    // Ignore local storage failures. Keep memory/server state for persistence.
  }
}

function persistLocally(update: UserSettingsUpdate) {
  if (update.theme) {
    writeStringSetting(THEME_KEY, update.theme);
  }

  if (update.sidebarCollapsed !== undefined) {
    writeBooleanSetting(SIDEBAR_COLLAPSE_KEY, update.sidebarCollapsed);
  }

  if (Object.prototype.hasOwnProperty.call(update, "selectedTenantId")) {
    const tenantId = update.selectedTenantId;
    if (tenantId === null || typeof tenantId === "string") {
      writeStringSetting(
        SELECTED_TENANT_KEY,
        tenantId
      );
    }
  }

  if (update.cartAutoOpenOnAdd !== undefined) {
    writeCartAutoOpenSetting(update.cartAutoOpenOnAdd);
  }

  if (update.viewMode) {
    writeStringSetting(VIEW_MODE_KEY, update.viewMode);
  }

  if (update.quickStartDismissed !== undefined) {
    writeBooleanSetting(QUICK_START_DISMISSED_KEY, update.quickStartDismissed);
  }

  if (update.onboardingCompleted !== undefined) {
    writeBooleanSetting(ONBOARDING_COMPLETED_KEY, update.onboardingCompleted);
  }

  if (update.carryOverAssignments !== undefined) {
    writeBooleanSetting(CARRY_OVER_ASSIGNMENTS_KEY, update.carryOverAssignments);
  }

  if (update.supersedePreviousApp !== undefined) {
    writeBooleanSetting(SUPERSEDE_PREVIOUS_APP_KEY, update.supersedePreviousApp);
  }
}

function hasAnyLegacySetting(
  values: ReturnType<typeof readLegacyUserSettings>
) {
  return (
    values.hasTheme ||
    values.hasSidebarCollapsed ||
    values.hasSelectedTenantId ||
    values.hasCartAutoOpenOnAdd
  );
}

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isInitializing, account, getAccessToken } = useMicrosoftAuth();
  const accountKey =
    isAuthenticated && !isInitializing && account
      ? JSON.stringify([account.homeAccountId, account.tenantId])
      : null;
  const [scope, setScope] = useState(() => ({ key: accountKey, generation: 0 }));
  let renderScope = scope;
  if (scope.key !== accountKey) {
    renderScope = { key: accountKey, generation: scope.generation + 1 };
    setScope(renderScope);
  }
  const generation = renderScope.generation;
  const accountScopeRef = useRef(scope);
  const loadSequenceRef = useRef(0);
  const defaultsRevisionRef = useRef(0);
  useLayoutEffect(() => { accountScopeRef.current = scope; }, [scope]);
  const [scopedDefaults, setScopedDefaults] = useState<ScopedPackageDefaults | null>(null);
  const packageDefaults =
    accountKey !== null && scopedDefaults?.generation === generation ? scopedDefaults.value : null;
  const packageDefaultsStatus = accountKey === null ? 'loaded'
    : scopedDefaults?.generation === generation ? scopedDefaults.status : 'loading';

  const [settings, setSettingsState] = useState<UserSettings>(() => {
    return readLegacyUserSettings().settings;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [hasStoredSettings, setHasStoredSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    const sidebarStore = useSidebarStore.getState();
    const cartStore = useCartStore.getState();

    if (sidebarStore.isCollapsed !== settings.sidebarCollapsed) {
      sidebarStore.setCollapsedFromServer(settings.sidebarCollapsed);
    }
    if (cartStore.autoOpenOnAdd !== settings.cartAutoOpenOnAdd) {
      cartStore.setAutoOpenOnAddFromServer(settings.cartAutoOpenOnAdd);
    }
  }, [settings.sidebarCollapsed, settings.cartAutoOpenOnAdd]);

  const applySettings = useCallback((update: UserSettingsUpdate) => {
    setSettingsState((current) => ({ ...current, ...update }));
    persistLocally(update);
  }, []);

  const syncToServer = useCallback(
    async (update: UserSettingsUpdate): Promise<void> => {
      if (!isAuthenticated) {
        return;
      }

      const requestScope = accountScopeRef.current;
      if (requestScope.key === null) return;
      const isCurrent = () => accountScopeRef.current.generation === requestScope.generation;
      setIsSaving(true);
      setSyncError(null);

      try {
        const token = await getAccessToken();
        if (!isCurrent()) return;
        if (!token) {
          setSyncError("No active authentication token. Settings saved locally.");
          setHasStoredSettings(false);
          return;
        }

        const response = await patchUserSettings(token, update);
        if (!isCurrent()) return;
        const split = splitServerSettings(response.settings);
        setSettingsState(split.settings);
        setHasStoredSettings(Boolean(response.hasStoredSettings));
      } catch (error) {
        if (!isCurrent()) return;
        setSyncError(
          error instanceof Error
            ? error.message
            : "Failed to sync settings. Changes kept locally."
        );
        setHasStoredSettings(false);
      } finally {
        if (isCurrent()) setIsSaving(false);
      }
    },
    [getAccessToken, isAuthenticated]
  );

  const updateSettings = useCallback(
    async (update: UserSettingsUpdate) => {
      applySettings(update);
      await syncToServer(update);
    },
    [applySettings, syncToServer]
  );

  const loadFromServer = useCallback(async () => {
    const requestScope = accountScopeRef.current;
    if (!isAuthenticated || requestScope.key === null) {
      return;
    }
    const sequence = ++loadSequenceRef.current;
    const defaultsRevision = defaultsRevisionRef.current;
    const isCurrent = () => accountScopeRef.current.generation === requestScope.generation && loadSequenceRef.current === sequence;

    setIsLoading(true);
    setSyncError(null);

    try {
      const token = await getAccessToken();
      if (!isCurrent()) return;
      if (!token) {
        setSyncError("No active authentication token. Using local settings.");
        if (defaultsRevisionRef.current === defaultsRevision) {
          setScopedDefaults({ generation: requestScope.generation, value: null, status: 'error' });
        }
        setHasStoredSettings(false);
        return;
      }

      const legacy = readLegacyUserSettings();
      const response = await getUserSettings(token);
      if (!isCurrent()) return;

      const split = splitServerSettings(response.settings);
      applySettings(split.settings);
      if (defaultsRevisionRef.current === defaultsRevision) {
        setScopedDefaults({ generation: requestScope.generation, value: split.packageDefaults, status: 'loaded' });
      }
      setHasStoredSettings(Boolean(response.hasStoredSettings));

      if (!response.hasStoredSettings && hasAnyLegacySetting(legacy)) {
        const migrationPatch: UserSettingsUpdate = {};

        if (legacy.hasTheme) {
          migrationPatch.theme = legacy.settings.theme;
        }
        if (legacy.hasSidebarCollapsed) {
          migrationPatch.sidebarCollapsed = legacy.settings.sidebarCollapsed;
        }
        if (legacy.hasSelectedTenantId) {
          migrationPatch.selectedTenantId = legacy.settings.selectedTenantId;
        }
        if (legacy.hasCartAutoOpenOnAdd) {
          migrationPatch.cartAutoOpenOnAdd = legacy.settings.cartAutoOpenOnAdd;
        }

        if (Object.keys(migrationPatch).length > 0) {
          const migrated = await patchUserSettings(token, migrationPatch);
          if (!isCurrent()) return;
          applySettings(splitServerSettings(migrated.settings).settings);
          setHasStoredSettings(Boolean(migrated.hasStoredSettings));
        }
      }
    } catch {
      if (!isCurrent()) return;
      setSyncError("Unable to load server settings. Using local settings.");
      if (defaultsRevisionRef.current === defaultsRevision) {
        setScopedDefaults({ generation: requestScope.generation, value: null, status: 'error' });
      }
      setHasStoredSettings(false);
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [generation, applySettings, getAccessToken, isAuthenticated]);

  useEffect(() => {
    setIsSaving(false);
    setSyncError(null);
    if (accountKey !== null) {
      void loadFromServer();
    } else {
      setIsLoading(false);
    }
  }, [accountKey, loadFromServer]);

  const savePackageDefaults = useCallback(
    async (defaults: PackageDefaults | null) => {
      const requestScope = accountScopeRef.current;
      if (requestScope.key === null) {
        throw new Error("Sign in to save package defaults.");
      }
      const token = await getAccessToken();
      if (accountScopeRef.current.generation !== requestScope.generation) {
        throw new Error("Account changed. Package defaults were not saved for the current account.");
      }
      if (!token) {
        throw new Error("No active authentication token. Package defaults were not saved.");
      }
      const response = await patchUserSettings(token, { packageDefaults: defaults });
      if (accountScopeRef.current.generation !== requestScope.generation) {
        throw new Error("Account changed. Package defaults were not saved for the current account.");
      }
      defaultsRevisionRef.current += 1;
      setScopedDefaults({
        generation: requestScope.generation,
        value: splitServerSettings(response.settings).packageDefaults,
        status: 'loaded',
      });
    },
    [getAccessToken]
  );

  const setTheme = useCallback(
    async (theme: ThemeMode) => {
      await updateSettings({ theme });
    },
    [updateSettings]
  );

  const setSidebarCollapsed = useCallback(
    async (sidebarCollapsed: boolean) => {
      await updateSettings({ sidebarCollapsed });
    },
    [updateSettings]
  );

  const setSelectedTenantId = useCallback(
    async (selectedTenantId: string | null) => {
      await updateSettings({ selectedTenantId });
    },
    [updateSettings]
  );

  const setCartAutoOpenOnAdd = useCallback(
    async (cartAutoOpenOnAdd: boolean) => {
      await updateSettings({ cartAutoOpenOnAdd });
    },
    [updateSettings]
  );

  const setViewMode = useCallback(
    async (viewMode: ViewMode) => {
      await updateSettings({ viewMode });
    },
    [updateSettings]
  );

  const setQuickStartDismissed = useCallback(
    async (quickStartDismissed: boolean) => {
      await updateSettings({ quickStartDismissed });
    },
    [updateSettings]
  );

  const setOnboardingCompleted = useCallback(
    async (onboardingCompleted: boolean) => {
      await updateSettings({ onboardingCompleted });
    },
    [updateSettings]
  );

  const setCarryOverAssignments = useCallback(
    async (carryOverAssignments: boolean) => {
      await updateSettings({ carryOverAssignments });
    },
    [updateSettings]
  );

  const setSupersedePreviousApp = useCallback(
    async (supersedePreviousApp: boolean) => {
      await updateSettings({ supersedePreviousApp });
    },
    [updateSettings]
  );

  const value = useMemo<UserSettingsContextValue>(
    () => ({
      settings,
      isLoading,
      hasStoredSettings,
      isSaving,
      syncError,
      setTheme,
      setSidebarCollapsed,
      setSelectedTenantId,
      setCartAutoOpenOnAdd,
      setViewMode,
      setQuickStartDismissed,
      setOnboardingCompleted,
      setCarryOverAssignments,
      setSupersedePreviousApp,
      packageDefaults,
      packageDefaultsStatus,
      packageDefaultsAccountScope: generation,
      savePackageDefaults,
    }),
    [
      packageDefaults,
      packageDefaultsStatus,
      generation,
      savePackageDefaults,
      hasStoredSettings,
      isLoading,
      isSaving,
      settings,
      setTheme,
      setSidebarCollapsed,
      setSelectedTenantId,
      setCartAutoOpenOnAdd,
      setViewMode,
      setQuickStartDismissed,
      setOnboardingCompleted,
      setCarryOverAssignments,
      setSupersedePreviousApp,
      syncError,
    ]
  );

  return (
    <UserSettingsContext.Provider value={value}>
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings() {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error("useUserSettings must be used within a UserSettingsProvider");
  }
  return context;
}
