/**
 * Upload and Staging Types
 * For package staging, job tracking, and deployment workflow
 */

import type { DetectionRule, RequirementRule, AppRelationship } from './intune';
import type { WingetArchitecture, WingetScope, WingetInstallerType } from './winget';
import type { PSADTConfig } from './psadt';
import type { EspProfileSelection } from './esp';

// Staged package awaiting upload to Intune
export interface StagedPackage {
  id: string;
  userId: string;
  wingetId: string;
  displayName: string;
  publisher: string;
  version: string;
  architecture: WingetArchitecture;
  installScope: WingetScope;
  installerType: WingetInstallerType;

  // Package artifacts
  intunewinUrl?: string;
  intunewinSizeBytes?: number;
  installerUrl: string;
  installerSha256: string;

  // Commands
  installCommand: string;
  uninstallCommand: string;

  // Detection
  detectionRules: DetectionRule[];

  description?: string;
  iconPath?: string; // Icon path for the Intune app largeIcon

  // Requirement rules (for "Update Only" - check app existence before install)
  requirementRules?: RequirementRule[];

  // Status
  status: StagedPackageStatus;
  errorMessage?: string;

  // Timestamps
  createdAt: string;
  expiresAt?: string;
}

export type StagedPackageStatus =
  | 'pending'      // Awaiting packaging
  | 'packaging'    // Being processed by Azure Function
  | 'ready'        // Package ready for upload
  | 'uploading'    // Being uploaded to Intune
  | 'uploaded'     // Successfully deployed
  | 'failed';      // Error occurred

// Upload job tracking
export interface UploadJob {
  id: string;
  userId: string;
  stagedPackageId: string;

  // Intune details
  intuneAppId?: string;
  intuneAppUrl?: string;

  // Assignment
  assignedGroups?: GroupAssignment[];

  // Status
  status: UploadJobStatus;
  progressPercent: number;
  currentStep?: string;
  errorMessage?: string;

  // Timestamps
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export type UploadJobStatus =
  | 'queued'       // In queue awaiting processing
  | 'packaging'    // Creating .intunewin package
  | 'uploading'    // Uploading to Intune
  | 'configuring'  // Setting detection rules and assignments
  | 'completed'    // Successfully deployed
  | 'failed';      // Error occurred

export interface GroupAssignment {
  groupId: string;
  groupName: string;
  intent: 'required' | 'available' | 'uninstall' | 'updateOnly';
}

// Flexible assignment target for package configuration
export interface PackageAssignment {
  type: 'allUsers' | 'allDevices' | 'group' | 'exclusionGroup';
  intent: 'required' | 'available' | 'uninstall' | 'updateOnly';
  groupId?: string;      // Only for type 'group' or 'exclusionGroup'
  groupName?: string;    // Display name for UI
  filterId?: string;       // Intune assignment filter ID
  filterName?: string;     // Display name for UI
  filterType?: 'include' | 'exclude';  // Filter mode
}

export interface IntuneAppCategorySelection {
  id: string;
  displayName: string;
}

// Package configuration form data
export interface PackageConfiguration {
  wingetId: string;
  version: string;
  architecture: WingetArchitecture;
  installScope: WingetScope;

  // Optional overrides
  customInstallCommand?: string;
  customUninstallCommand?: string;
  customDetectionRules?: DetectionRule[];

  // Assignment
  assignToGroups?: GroupAssignment[];
}

// Base fields shared by all cart item types
interface CartItemBase {
  id: string; // Unique cart item ID
  wingetId: string;
  displayName: string;
  publisher: string;
  description?: string;
  version: string;
  iconPath?: string; // Icon path for display (parent icon for locale variants)

  // Assignment configuration
  assignments?: PackageAssignment[];

  // Intune category configuration
  categories?: IntuneAppCategorySelection[];

  // ESP profile configuration
  espProfiles?: EspProfileSelection[];

  // App relationships (dependencies / supersedence)
  relationships?: AppRelationship[];

  // Redeploy flag - skip duplicate detection during deployment
  forceCreate?: boolean;

  // Cart metadata
  addedAt: string;
}

// Win32 LOB app - goes through packaging pipeline (PSADT + .intunewin + GitHub Actions)
export interface Win32CartItem extends CartItemBase {
  appSource: 'win32';
  localeCode?: string; // Selected locale for language variant packages
  architecture: WingetArchitecture;
  installScope: WingetScope;
  installerType: WingetInstallerType;
  installerUrl: string;
  installerSha256: string;
  installCommand: string;
  uninstallCommand: string;
  detectionRules: DetectionRule[];
  requirementRules?: RequirementRule[];
  psadtConfig: PSADTConfig;
}

// Microsoft Store app - deployed via Graph API winGetApp (single API call, no packaging)
export interface StoreCartItem extends CartItemBase {
  appSource: 'store';
  packageIdentifier: string; // Microsoft Store product ID, e.g. "9WZDNCRFJ3PZ"
  installExperience: 'user' | 'system';
}

// Discriminated union - use appSource to distinguish
export type CartItem = Win32CartItem | StoreCartItem;

// Input type for adding items to the cart (without auto-generated fields)
export type NewCartItem = Omit<Win32CartItem, 'id' | 'addedAt'> | Omit<StoreCartItem, 'id' | 'addedAt'>;

// Type guards
export function isStoreCartItem(item: CartItem): item is StoreCartItem {
  return item.appSource === 'store';
}

export function isWin32CartItem(item: CartItem): item is Win32CartItem {
  // Missing appSource defaults to win32 for backward compatibility with persisted carts
  return !item.appSource || item.appSource === 'win32';
}

// Batch upload request
export interface BatchUploadRequest {
  items: CartItem[];
  commonSettings?: {
    installScope?: WingetScope;
    assignToGroups?: GroupAssignment[];
  };
}

// Packaging job for Azure Function queue
export interface PackagingJob {
  id: string;
  userId: string;
  stagedPackageId: string;

  // Download info
  downloadUrl: string;
  installerType: WingetInstallerType;
  installerSha256: string;

  // Package info
  packageId: string;
  version: string;
  displayName: string;
  publisher: string;

  // Installation
  installCommand: string;
  uninstallCommand: string;
  installScope: WingetScope;
  architecture: WingetArchitecture;

  // Detection
  detectionRules: DetectionRule[];

  // Timestamps
  createdAt: string;
}

// Packaging result from Azure Function
export interface PackagingResult {
  success: boolean;
  stagedPackageId: string;

  // On success
  intunewinUrl?: string;
  intunewinSizeBytes?: number;
  encryptionInfo?: IntunewinEncryptionInfo;

  // On failure
  errorMessage?: string;
  errorCode?: string;
}

// Encryption info for .intunewin
export interface IntunewinEncryptionInfo {
  encryptionKey: string;
  macKey: string;
  initializationVector: string;
  mac: string;
  profileIdentifier: string;
  fileDigest: string;
  fileDigestAlgorithm: string;
}

// User profile with Microsoft credentials
export interface UserProfile {
  id: string;
  email: string;
  name?: string;

  // Microsoft OAuth
  microsoftAccessToken?: string;
  microsoftRefreshToken?: string;
  tokenExpiresAt?: string;

  // Intune tenant
  intuneTenantId?: string;
  tenantName?: string;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// App metadata for curated configurations
export interface AppMetadata {
  id: string;
  wingetId: string;
  displayName?: string;
  publisher?: string;
  category?: string;

  // Detection rules stored as metadata
  detectionRules?: DetectionRule[];
  detectionScript?: string;

  // Installation configuration
  installCommandOverride?: string;
  uninstallCommandOverride?: string;
  installBehavior: 'system' | 'user';

  // Quality metadata
  testedVersion?: string;
  knownIssues?: string;
  notes?: string;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// Real-time upload progress update
export interface UploadProgressUpdate {
  jobId: string;
  status: UploadJobStatus;
  progressPercent: number;
  currentStep: string;
  timestamp: string;
}

// Dashboard statistics
export interface DashboardStats {
  totalPackagesDeployed: number;
  packagesThisMonth: number;
  pendingUploads: number;
  failedUploads: number;
  recentActivity: RecentActivity[];
}

export interface RecentActivity {
  id: string;
  type: 'upload' | 'package' | 'error';
  description: string;
  timestamp: string;
  status: 'success' | 'pending' | 'failed';
  relatedId?: string;
}
