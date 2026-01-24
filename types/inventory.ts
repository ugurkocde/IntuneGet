/**
 * Inventory Types
 * TypeScript interfaces for Intune Win32 apps
 */

export interface IntuneWin32App {
  id: string;
  displayName: string;
  description: string | null;
  publisher: string | null;
  displayVersion: string | null;
  fileName: string | null;
  installCommandLine: string | null;
  uninstallCommandLine: string | null;
  installExperience: {
    runAsAccount: 'system' | 'user';
    deviceRestartBehavior: 'allow' | 'basedOnReturnCode' | 'suppress' | 'force';
  } | null;
  detectionRules: DetectionRule[] | null;
  requirementRules: RequirementRule[] | null;
  createdDateTime: string;
  lastModifiedDateTime: string;
  size: number | null;
  isFeatured: boolean;
  privacyInformationUrl: string | null;
  informationUrl: string | null;
  owner: string | null;
  developer: string | null;
  notes: string | null;
  largeIcon: {
    type: string;
    value: string;
  } | null;
}

export interface DetectionRule {
  '@odata.type': string;
  // Registry detection
  keyPath?: string;
  valueName?: string;
  detectionType?: 'exists' | 'doesNotExist' | 'string' | 'integer' | 'version';
  operator?: 'equal' | 'notEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual';
  detectionValue?: string;
  check32BitOn64System?: boolean;
  // File detection
  path?: string;
  fileOrFolderName?: string;
  // MSI detection
  productCode?: string;
  productVersion?: string;
  productVersionOperator?: string;
  // Script detection
  scriptContent?: string;
  enforceSignatureCheck?: boolean;
  runAs32Bit?: boolean;
}

export interface RequirementRule {
  '@odata.type': string;
  operator: string;
  osVersion?: string;
  // Script requirement
  scriptContent?: string;
  displayName?: string;
  enforceSignatureCheck?: boolean;
  runAs32Bit?: boolean;
  operationType?: string;
  expectedValue?: string;
  detectionType?: string;
}

export interface IntuneAppAssignment {
  id: string;
  intent: 'available' | 'required' | 'uninstall' | 'availableWithoutEnrollment';
  target: {
    '@odata.type': string;
    groupId?: string;
  };
  settings: {
    '@odata.type': string;
    notifications?: 'showAll' | 'showReboot' | 'hideAll';
    installTimeSettings?: {
      useLocalTime: boolean;
      startDateTime: string | null;
      deadlineDateTime: string | null;
    } | null;
    restartSettings?: {
      gracePeriodInMinutes: number;
      countdownDisplayBeforeRestartInMinutes: number;
      restartNotificationSnoozeDurationInMinutes: number;
    } | null;
  } | null;
}

export interface IntuneAppWithAssignments extends IntuneWin32App {
  assignments: IntuneAppAssignment[];
}

export interface InventoryFilters {
  search: string;
  publisher: string;
  sortBy: 'name' | 'publisher' | 'created' | 'modified';
  sortOrder: 'asc' | 'desc';
}

export interface InventoryState {
  apps: IntuneWin32App[];
  selectedApp: IntuneAppWithAssignments | null;
  filters: InventoryFilters;
  isLoading: boolean;
  error: string | null;
}

export interface AppUpdateInfo {
  intuneApp: IntuneWin32App;
  currentVersion: string;
  latestVersion: string;
  wingetId: string | null;
  hasUpdate: boolean;
}
