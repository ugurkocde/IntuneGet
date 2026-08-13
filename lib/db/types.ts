/**
 * Database Types for IntuneGet
 * Shared interfaces between SQLite and Supabase implementations
 */

import type { Json } from '@/types/database';

/**
 * Packaging job record
 */
export interface PackagingJob {
  id: string;
  user_id: string;
  user_email: string | null;
  tenant_id: string | null;
  winget_id: string;
  version: string;
  display_name: string;
  publisher: string | null;
  architecture: string | null;
  installer_type: string | null;
  installer_url: string | null;
  installer_sha256: string | null;
  install_command: string | null;
  uninstall_command: string | null;
  install_scope: string | null;
  silent_switches: string | null;
  detection_rules: Json | null;
  package_config: Json | null;
  github_run_id: string | null;
  github_run_url: string | null;
  intunewin_url: string | null;
  intunewin_size_bytes: number | null;
  unencrypted_content_size: number | null;
  encryption_info: Json | null;
  intune_app_id: string | null;
  intune_app_url: string | null;
  app_source: string | null;
  status: string;
  status_message: string | null;
  progress_percent: number;
  progress_message: string | null;
  error_message: string | null;
  error_stage: string | null;
  error_category: string | null;
  error_code: string | null;
  error_details: Json | null;
  warnings: Json | null;
  execution_profile_sha256: string | null;
  presentation_profile_sha256: string | null;
  qa_candidate_id: string | null;
  qa_requested_at: string | null;
  qa_completed_at: string | null;
  packager_id: string | null;
  packager_heartbeat_at: string | null;
  claimed_at: string | null;
  packaging_started_at: string | null;
  packaging_completed_at: string | null;
  upload_started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Upload history record
 */
export interface UploadHistoryRecord {
  id: string;
  packaging_job_id: string | null;
  user_id: string;
  winget_id: string;
  version: string;
  display_name: string;
  publisher: string | null;
  intune_app_id: string;
  intune_app_url: string | null;
  intune_tenant_id: string | null;
  app_source: string | null;
  deployed_at: string;
}

/**
 * A detected available update for one deployed app.
 *
 * Mirrors the update_check_results table (supabase/migrations 011, 018, 031).
 * The row is a cache: the comparison itself runs live against Intune and the
 * app catalog, and a refresh replaces a tenant's rows wholesale. What only
 * lives here is per-user state - dismissed_at and notified_at.
 */
export interface UpdateCheckResult {
  id: string;
  user_id: string;
  tenant_id: string;
  winget_id: string;
  intune_app_id: string;
  display_name: string;
  current_version: string;
  latest_version: string;
  is_critical: boolean;
  is_managed: boolean;
  large_icon_type: string | null;
  large_icon_value: string | null;
  notified_at: string | null;
  dismissed_at: string | null;
  detected_at: string;
  updated_at: string;
}

/**
 * Per-user settings blob.
 *
 * Mirrors the user_settings table (supabase/migrations/020). A single JSON
 * object per user; the app treats unknown keys as pass-through, so the shape
 * is deliberately open.
 */
export interface UserSettingsRecord {
  user_id: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Job statistics
 */
export interface JobStats {
  queued: number;
  packaging: number;
  uploading: number;
  deployed: number;
  failed: number;
  cancelled: number;
}

/**
 * Database adapter interface
 * Both SQLite and Supabase implementations must conform to this interface
 */
export interface DatabaseAdapter {
  jobs: {
    /**
     * Get jobs by status
     */
    getByStatus(status: string, limit?: number, ascending?: boolean): Promise<PackagingJob[]>;

    /**
     * Get a job by ID
     */
    getById(id: string): Promise<PackagingJob | null>;

    /**
     * Get jobs by user ID
     */
    getByUserId(userId: string, limit?: number): Promise<PackagingJob[]>;

    /**
     * Every job belonging to a user, newest first and uncapped.
     *
     * For aggregate statistics, where a page would silently undercount rather
     * than merely shorten the answer. Use getByUserId() for list views.
     */
    getAllByUserId(userId: string): Promise<PackagingJob[]>;

    /**
     * Get jobs for every user in a tenant (tenant-wide deployments view)
     */
    getByTenantId(tenantId: string, limit?: number): Promise<PackagingJob[]>;

    /**
     * Get every job in a tenant that reached a given status. Filters on the
     * status in the query rather than in the caller, so a tenant with more
     * jobs than any page size still yields a complete set - callers use this
     * to decide whether an app is already deployed, where a missing row reads
     * as "not deployed" rather than as a truncated list.
     */
    getByTenantIdAndStatus(tenantId: string, status: string): Promise<PackagingJob[]>;

    /**
     * Create a new job
     */
    create(job: Partial<PackagingJob>): Promise<PackagingJob>;

    /**
     * Update a job
     * @param id Job ID
     * @param data Fields to update
     * @param conditions Optional conditions for the update (e.g., { status: 'queued' })
     */
    update(id: string, data: Partial<PackagingJob>, conditions?: Record<string, unknown>): Promise<PackagingJob | null>;

    /**
     * Claim a job atomically (only if status is 'queued')
     */
    claim(jobId: string, packagerId: string): Promise<PackagingJob | null>;

    /**
     * Release a job back to queued state
     */
    release(jobId: string, packagerId: string): Promise<PackagingJob | null>;

    /**
     * Force release a stale job back to queued state (no packager_id check)
     */
    forceRelease(jobId: string): Promise<PackagingJob | null>;

    /**
     * Get stale jobs (packaging status with old heartbeat)
     */
    getStaleJobs(staleThreshold: Date): Promise<PackagingJob[]>;

    /**
     * Get job statistics
     */
    getStats(): Promise<JobStats>;

    /**
     * Soft-archive a single job by ID
     */
    deleteById(id: string): Promise<boolean>;

    /**
     * Bulk-archive jobs matching a user ID and a set of statuses
     * Returns the number of archived rows
     */
    deleteByUserIdAndStatuses(userId: string, statuses: string[]): Promise<number>;
  };

  uploadHistory: {
    /**
     * Create an upload history record
     */
    create(record: Partial<UploadHistoryRecord>): Promise<UploadHistoryRecord>;

    /**
     * Get upload history by user ID
     */
    getByUserId(userId: string, limit?: number): Promise<UploadHistoryRecord[]>;

    /**
     * Get a user's upload history within one tenant. Filters on the tenant in
     * the query rather than in the caller, so a user active in several
     * tenants cannot have this tenant's rows pushed out by another tenant's.
     */
    getByUserIdAndTenantId(userId: string, tenantId: string): Promise<UploadHistoryRecord[]>;
  };

  userSettings: {
    /**
     * A user's settings object, or null if they never saved any.
     */
    get(userId: string): Promise<Record<string, unknown> | null>;

    /**
     * Merge a partial settings object into the stored one and return the
     * result. Callers send only the keys they are changing, so this must
     * merge rather than replace.
     */
    merge(
      userId: string,
      partial: Record<string, unknown>
    ): Promise<Record<string, unknown>>;
  };

  updateCheckResults: {
    /**
     * Every detected update for a user, newest first. tenantId narrows to one
     * tenant; omit it for all tenants the user has results in.
     */
    getByUserId(userId: string, tenantId?: string | null): Promise<UpdateCheckResult[]>;

    /**
     * Replace a tenant's results for this user with a freshly detected set.
     *
     * A refresh re-derives every row from a live scan, so rows that are gone
     * from the scan must disappear rather than linger as phantom updates -
     * hence replace rather than merge. Callers carry notified_at forward
     * themselves, since only they know whether the version changed.
     */
    replaceForUserAndTenant(
      userId: string,
      tenantId: string,
      rows: Array<Partial<UpdateCheckResult>>
    ): Promise<UpdateCheckResult[]>;

    /**
     * Mark one detected update dismissed (or un-dismissed with null), scoped
     * to the owning user so one user cannot dismiss another's row.
     */
    setDismissedAt(
      id: string,
      userId: string,
      dismissedAt: string | null
    ): Promise<UpdateCheckResult | null>;
  };
}
