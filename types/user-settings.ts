import type { DeployMode, DialogPosition, RestartBehavior, RestartPromptConfig } from "./psadt";

export type ThemeMode = "light" | "dark";
export type ViewMode = "grid" | "list";

/**
 * Saved PSADT defaults for newly configured Win32 packages (#2085).
 * Only enums, booleans and bounded integers. Never commands, detection,
 * paths, process names, branding, free text or verifyInstall.
 */
export interface PackageDefaults {
  deployMode?: DeployMode;
  restartBehavior?: RestartBehavior;
  windowLocation?: DialogPosition;
  showClosePrompt?: boolean;
  blockExecution?: boolean;
  promptToSave?: boolean;
  persistPrompt?: boolean;
  minimizeWindows?: boolean;
  allowDefer?: boolean;
  checkDiskSpace?: boolean;
  removeExistingInstall?: boolean;
  closeCountdown?: number;
  deferTimes?: number;
  deferDays?: number;
  restartPrompt?: RestartPromptConfig;
}

export interface UserSettings {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  selectedTenantId: string | null;
  cartAutoOpenOnAdd: boolean;
  viewMode: ViewMode;
  quickStartDismissed: boolean;
  onboardingCompleted: boolean;
  carryOverAssignments: boolean;
  supersedePreviousApp: boolean;
}

export type UserSettingsUpdate = Partial<UserSettings>;

/** Server settings, including server only values the provider keeps apart. */
export interface StoredUserSettings extends UserSettings {
  packageDefaults: PackageDefaults | null;
}

export type StoredUserSettingsUpdate = Partial<StoredUserSettings>;

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: "light",
  sidebarCollapsed: false,
  selectedTenantId: null,
  cartAutoOpenOnAdd: true,
  viewMode: "grid",
  quickStartDismissed: false,
  onboardingCompleted: false,
  carryOverAssignments: false,
  supersedePreviousApp: false,
};

export interface UserSettingsResponse {
  settings: StoredUserSettings;
  hasStoredSettings?: boolean;
}
