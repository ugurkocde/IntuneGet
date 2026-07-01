/**
 * Unmanaged Apps Types
 * TypeScript interfaces for Intune unmanaged apps and claiming functionality
 */

/**
 * Match status for unmanaged apps
 */
export type MatchStatus = 'pending' | 'matched' | 'partial' | 'unmatched';

/**
 * Claim status for apps that have been claimed
 */
export type ClaimStatus = 'pending' | 'deploying' | 'deployed' | 'failed';

/**
 * Raw unmanaged app from Graph API
 */
export interface GraphUnmanagedApp {
  id: string;
  displayName: string;
  version: string | null;
  publisher: string | null;
  deviceCount: number;
  platform: 'windows' | 'macOS' | 'android' | 'iOS' | 'unknown';
  sizeInByte?: number;
}

/**
 * Unmanaged app with matching information
 */
export interface UnmanagedApp {
  id: string;
  discoveredAppId: string;
  displayName: string;
  version: string | null;
  publisher: string | null;
  deviceCount: number;
  platform: string;
  matchStatus: MatchStatus;
  matchedPackageId: string | null;
  matchedPackageName: string | null;
  matchConfidence: number | null;
  partialMatches?: PartialMatch[];
  isClaimed: boolean;
  claimStatus?: ClaimStatus;
  lastSynced: string;
}

/**
 * Partial match suggestion
 */
export interface PartialMatch {
  wingetId: string;
  name: string;
  publisher: string;
  version: string | null;
  confidence: number;
}

/**
 * Claimed app record
 */
export interface ClaimedApp {
  id: string;
  userId: string;
  tenantId: string;
  discoveredAppId: string;
  discoveredAppName: string;
  wingetPackageId: string;
  intuneAppId: string | null;
  deviceCountAtClaim: number | null;
  claimedAt: string;
  status: ClaimStatus;
}

/**
 * Manual app mapping
 */
export interface ManualAppMapping {
  id: string;
  discoveredAppName: string;
  discoveredPublisher: string | null;
  wingetPackageId: string;
  createdBy: string | null;
  tenantId: string | null;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Unmanaged apps cache entry
 */
export interface UnmanagedAppCache {
  id: string;
  userId: string;
  tenantId: string;
  discoveredAppId: string;
  displayName: string;
  version: string | null;
  publisher: string | null;
  deviceCount: number;
  platform: string;
  matchedPackageId: string | null;
  matchConfidence: number | null;
  matchStatus: MatchStatus;
  appData: GraphUnmanagedApp;
  lastSynced: string;
  createdAt: string;
}

/**
 * Filter options for unmanaged apps list
 */
export interface UnmanagedAppsFilters {
  search: string;
  matchStatus: MatchStatus | 'all';
  sortBy: 'name' | 'deviceCount' | 'publisher' | 'matchStatus';
  sortOrder: 'asc' | 'desc';
  showClaimed: boolean;
}

/**
 * Response from unmanaged apps API
 */
export interface UnmanagedAppsResponse {
  apps: UnmanagedApp[];
  total: number;
  lastSynced: string | null;
  fromCache: boolean;
  /** True when the live Intune fetch failed and cached data is served instead */
  stale?: boolean;
  /** Human-readable reason why stale cached data is being served */
  staleReason?: string;
  /** Timestamp of the last successful sync (set when stale is true) */
  lastSyncedAt?: string;
}

/**
 * A single device an app is installed on (drill-down from the device count)
 */
export interface DeviceListItem {
  id: string;
  deviceName: string;
  operatingSystem?: string | null;
}

/**
 * Response from the detected-app-devices API (device drill-down)
 */
export interface DetectedAppDevicesResponse {
  /** Distinct devices the app is installed on, deduplicated across versions */
  devices: DeviceListItem[];
  /** Number of distinct devices (devices.length) */
  total: number;
  /**
   * The app's displayed device count (summed across versions). Present so the
   * modal can explain a discrepancy when a device has multiple versions
   * installed and is therefore counted once here but twice in the sum.
   */
  summedDeviceCount?: number;
  /** True when the per-version fan-out was capped (very high version churn) */
  truncated?: boolean;
  /**
   * True when the scan ran out of its time budget (e.g. Graph throttling) and
   * the device list is incomplete. A later retry can return the full list.
   */
  partial?: boolean;
}

/**
 * Request body for claiming an app
 */
export interface ClaimAppRequest {
  discoveredAppId: string;
  discoveredAppName: string;
  wingetPackageId: string;
  deviceCount: number;
}

/**
 * Request body for creating manual mapping
 */
export interface CreateMappingRequest {
  discoveredAppName: string;
  discoveredPublisher?: string;
  wingetPackageId: string;
}

/**
 * Stats for unmanaged apps dashboard
 */
export interface UnmanagedAppsStats {
  total: number;
  matched: number;
  partial: number;
  unmatched: number;
  claimed: number;
  totalDevices: number;
}
