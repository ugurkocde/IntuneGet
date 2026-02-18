/**
 * Microsoft Intune API Types
 * Based on Microsoft Graph API for Win32 app management
 */

// Win32 LOB App
export interface IntuneWin32App {
  id: string;
  displayName: string;
  description?: string;
  publisher?: string;
  largeIcon?: MimeContent;
  isFeatured?: boolean;
  privacyInformationUrl?: string;
  informationUrl?: string;
  owner?: string;
  developer?: string;
  notes?: string;
  fileName: string;
  installCommandLine: string;
  uninstallCommandLine: string;
  applicableArchitectures: Win32AppArchitecture;
  minimumFreeDiskSpaceInMB?: number;
  minimumMemoryInMB?: number;
  minimumNumberOfProcessors?: number;
  minimumCpuSpeedInMHz?: number;
  minimumSupportedOperatingSystem: WindowsMinimumOperatingSystem;
  detectionRules: DetectionRule[];
  requirementRules?: RequirementRule[];
  rules?: Win32LobAppRule[];
  installExperience: Win32LobAppInstallExperience;
  returnCodes?: Win32LobAppReturnCode[];
  msiInformation?: Win32LobAppMsiInformation;
  setupFilePath?: string;
  minimumSupportedWindowsRelease?: string;
}

// MIME content for icons
export interface MimeContent {
  type: string;
  value: string; // Base64 encoded
}

// Architecture flags
export type Win32AppArchitecture = 'none' | 'x86' | 'x64' | 'arm' | 'neutral' | 'arm64' | 'x86,x64' | 'x86,arm' | 'x64,arm64' | 'x86,x64,arm' | 'x86,x64,arm64';

// Minimum OS requirements
export interface WindowsMinimumOperatingSystem {
  v8_0?: boolean;
  v8_1?: boolean;
  v10_0?: boolean;
  v10_1607?: boolean;
  v10_1703?: boolean;
  v10_1709?: boolean;
  v10_1803?: boolean;
  v10_1809?: boolean;
  v10_1903?: boolean;
  v10_1909?: boolean;
  v10_2004?: boolean;
  v10_2H20?: boolean;
  v10_21H1?: boolean;
}

// Detection rules union type
export type DetectionRule =
  | MsiDetectionRule
  | FileDetectionRule
  | RegistryDetectionRule
  | ScriptDetectionRule;

// MSI Product Code detection
export interface MsiDetectionRule {
  type: 'msi';
  productCode: string;
  productVersionOperator?: DetectionOperator;
  productVersion?: string;
}

// File-based detection
export interface FileDetectionRule {
  type: 'file';
  path: string;
  fileOrFolderName: string;
  check32BitOn64System?: boolean;
  detectionType: FileDetectionType;
  operator?: DetectionOperator;
  detectionValue?: string;
}

export type FileDetectionType =
  | 'exists'
  | 'notExists'
  | 'version'
  | 'dateModified'
  | 'dateCreated'
  | 'string'
  | 'sizeInMB';

// Registry-based detection
export interface RegistryDetectionRule {
  type: 'registry';
  keyPath: string;
  valueName?: string;
  check32BitOn64System?: boolean;
  detectionType: RegistryDetectionType;
  operator?: DetectionOperator;
  detectionValue?: string;
}

export type RegistryDetectionType =
  | 'exists'
  | 'notExists'
  | 'string'
  | 'integer'
  | 'version';

// Script-based detection
export interface ScriptDetectionRule {
  type: 'script';
  scriptContent: string;
  enforceSignatureCheck?: boolean;
  runAs32Bit?: boolean;
}

// Detection operator
export type DetectionOperator =
  | 'equal'
  | 'notEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual';

// Requirement rules (Graph API rules array format with ruleType: 'requirement')
export type RequirementRule =
  | FileRequirementRule
  | RegistryRequirementRule
  | ScriptRequirementRule;

export interface FileRequirementRule {
  '@odata.type': '#microsoft.graph.win32LobAppFileSystemRule';
  ruleType: 'requirement';
  path: string;
  fileOrFolderName: string;
  check32BitOn64System?: boolean;
  operationType: 'exists' | 'notExists';
}

export interface RegistryRequirementRule {
  '@odata.type': '#microsoft.graph.win32LobAppRegistryRule';
  ruleType: 'requirement';
  keyPath: string;
  valueName?: string;
  check32BitOn64System?: boolean;
  operationType: 'exists';
}

export interface ScriptRequirementRule {
  '@odata.type': '#microsoft.graph.win32LobAppPowerShellScriptRule';
  ruleType: 'requirement';
  displayName: string;
  scriptContent: string; // base64-encoded
  enforceSignatureCheck: boolean;
  runAs32Bit: boolean;
  runAsAccount: 'system' | 'user';
  operationType: 'boolean';
  operator: 'equal';
  comparisonValue: 'True';
}

// Win32 LOB App Rule
export interface Win32LobAppRule {
  '@odata.type': string;
  ruleType: 'detection' | 'requirement';
}

// Install experience
export interface Win32LobAppInstallExperience {
  runAsAccount: 'system' | 'user';
  deviceRestartBehavior: 'allow' | 'basedOnReturnCode' | 'suppress' | 'force';
  maxRunTimeInMinutes?: number;
}

// Return codes
export interface Win32LobAppReturnCode {
  returnCode: number;
  type: 'success' | 'failed' | 'hardReboot' | 'softReboot' | 'retry';
}

// MSI Information
export interface Win32LobAppMsiInformation {
  productCode?: string;
  productVersion?: string;
  upgradeCode?: string;
  requiresReboot?: boolean;
  packageType?: 'perMachine' | 'perUser' | 'dualPurpose';
  productName?: string;
  publisher?: string;
}

// Content upload types
export interface Win32LobAppContentFile {
  '@odata.type': '#microsoft.graph.mobileAppContentFile';
  name: string;
  size: number;
  sizeEncrypted: number;
  manifest?: string;
  isDependency?: boolean;
}

export interface Win32LobAppContentFileUploadState {
  azureStorageUri?: string;
  azureStorageUriExpirationDateTime?: string;
  isCommitted?: boolean;
  uploadState?: 'success' | 'transientError' | 'error' | 'unknown' | 'azureStorageUriRequestSuccess' | 'azureStorageUriRequestPending' | 'azureStorageUriRequestFailed' | 'azureStorageUriRequestTimedOut' | 'azureStorageUriRenewalSuccess' | 'azureStorageUriRenewalPending' | 'azureStorageUriRenewalFailed' | 'azureStorageUriRenewalTimedOut' | 'commitFileSuccess' | 'commitFilePending' | 'commitFileFailed' | 'commitFileTimedOut';
}

// App assignment
export interface Win32LobAppAssignment {
  '@odata.type': '#microsoft.graph.mobileAppAssignment';
  intent: 'available' | 'required' | 'uninstall' | 'availableWithoutEnrollment';
  target: AssignmentTarget;
  settings?: Win32LobAppAssignmentSettings;
}

export interface AssignmentTarget {
  '@odata.type':
    | '#microsoft.graph.groupAssignmentTarget'
    | '#microsoft.graph.exclusionGroupAssignmentTarget'
    | '#microsoft.graph.allLicensedUsersAssignmentTarget'
    | '#microsoft.graph.allDevicesAssignmentTarget';
  groupId?: string;
  deviceAndAppManagementAssignmentFilterId?: string;
  deviceAndAppManagementAssignmentFilterType?: 'include' | 'exclude';
}

export interface IntuneAssignmentFilter {
  id: string;
  displayName: string;
  description?: string;
  platform: string;
  rule?: string;
}

export interface Win32LobAppAssignmentSettings {
  '@odata.type': '#microsoft.graph.win32LobAppAssignmentSettings';
  notifications?: 'showAll' | 'showReboot' | 'hideAll';
  restartSettings?: Win32LobAppRestartSettings;
  installTimeSettings?: MobileAppInstallTimeSettings;
  deliveryOptimizationPriority?: 'notConfigured' | 'foreground';
}

export interface Win32LobAppRestartSettings {
  gracePeriodInMinutes?: number;
  countdownDisplayBeforeRestartInMinutes?: number;
  restartNotificationSnoozeDurationInMinutes?: number;
}

export interface MobileAppInstallTimeSettings {
  useLocalTime?: boolean;
  startDateTime?: string;
  deadlineDateTime?: string;
}

// Graph API response types
export interface GraphApiResponse<T> {
  '@odata.context'?: string;
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  value?: T[];
}

// Intune mobile app category
export interface IntuneMobileAppCategory {
  id: string;
  displayName: string;
  lastModifiedDateTime?: string;
}

// Entra ID Group
export interface EntraIDGroup {
  id: string;
  displayName: string;
  description?: string;
  membershipRule?: string;
  securityEnabled?: boolean;
  groupTypes?: string[];
}
