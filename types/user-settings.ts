export type ThemeMode = "light" | "dark";
export type ViewMode = "grid" | "list";

export interface UserSettings {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  selectedTenantId: string | null;
  cartAutoOpenOnAdd: boolean;
  viewMode: ViewMode;
  quickStartDismissed: boolean;
  onboardingCompleted: boolean;
  carryOverAssignments: boolean;
}

export type UserSettingsUpdate = Partial<UserSettings>;

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: "light",
  sidebarCollapsed: false,
  selectedTenantId: null,
  cartAutoOpenOnAdd: true,
  viewMode: "grid",
  quickStartDismissed: false,
  onboardingCompleted: false,
  carryOverAssignments: false,
};

export interface UserSettingsResponse {
  settings: UserSettings;
  hasStoredSettings?: boolean;
}
