/**
 * Upload and Staging Types
 * For package staging, job tracking, and deployment workflow
 */

import type { DetectionRule } from './intune';
import type { WingetArchitecture, WingetScope, WingetInstallerType } from './winget';
import type { PSADTConfig } from './psadt';

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
  intent: 'required' | 'available' | 'uninstall';
}

// Flexible assignment target for package configuration
export interface PackageAssignment {
  type: 'allUsers' | 'allDevices' | 'group';
  intent: 'required' | 'available' | 'uninstall';
  groupId?: string;      // Only for type 'group'
  groupName?: string;    // Display name for UI
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

// Cart item for batch uploads
export interface CartItem {
  id: string; // Unique cart item ID
  wingetId: string;
  displayName: string;
  publisher: string;
  version: string;
  architecture: WingetArchitecture;
  installScope: WingetScope;
  installerType: WingetInstallerType;
  installerUrl: string;
  installerSha256: string;

  // Configuration
  installCommand: string;
  uninstallCommand: string;
  detectionRules: DetectionRule[];

  // PSADT Configuration
  psadtConfig: PSADTConfig;

  // Assignment configuration
  assignments?: PackageAssignment[];

  // Cart metadata
  addedAt: string;
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
