/**
 * Database Types for IntuneGet
 * Shared interfaces between SQLite and Supabase implementations
 */

import type { Json } from '@/types/database';
import type {
  AppUpdatePolicy,
  AutoUpdateHistory,
  AutoUpdateHistoryWithPolicy,
  AutoUpdateStatus,
} from '@/types/update-policies';

/**
 * Query options for auto-update history reads.
 */
export interface AutoUpdateHistoryQuery {
  tenantId?: string;
  wingetId?: string;
  status?: AutoUpdateStatus;
  limit: number;
  offset: number;
}

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
     * Get jobs for every user in a tenant (tenant-wide deployments view)
     */
    getByTenantId(tenantId: string, limit?: number): Promise<PackagingJob[]>;

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
  };

  updatePolicies: {
    /**
     * List every policy for a user, newest first, optionally scoped to a tenant
     */
    list(userId: string, tenantId?: string): Promise<AppUpdatePolicy[]>;

    /**
     * Get one policy owned by the user
     */
    getById(id: string, userId: string): Promise<AppUpdatePolicy | null>;

    /**
     * Get the policy for a user, tenant, and app (the unique key)
     */
    getByKey(userId: string, tenantId: string, wingetId: string): Promise<AppUpdatePolicy | null>;

    /**
     * Insert or replace a policy on the (user_id, tenant_id, winget_id) key
     */
    upsert(
      policy: Partial<AppUpdatePolicy> &
        Pick<AppUpdatePolicy, 'user_id' | 'tenant_id' | 'winget_id' | 'policy_type'>
    ): Promise<AppUpdatePolicy>;

    /**
     * Update a policy owned by the user. Returns null when no row matched.
     */
    update(id: string, userId: string, data: Partial<AppUpdatePolicy>): Promise<AppUpdatePolicy | null>;

    /**
     * Delete a policy owned by the user. Returns false when no row matched.
     */
    delete(id: string, userId: string): Promise<boolean>;
  };

  autoUpdateHistory: {
    /**
     * Create an auto-update history record
     */
    create(
      record: Partial<AutoUpdateHistory> &
        Pick<AutoUpdateHistory, 'policy_id' | 'from_version' | 'to_version' | 'update_type'>
    ): Promise<AutoUpdateHistory>;

    /**
     * Update a history record. Returns null when no row matched.
     */
    update(id: string, data: Partial<AutoUpdateHistory>): Promise<AutoUpdateHistory | null>;

    /**
     * List a user's history with the policy target and deployed app name,
     * newest first, honoring the optional filters and pagination.
     */
    list(userId: string, query: AutoUpdateHistoryQuery): Promise<AutoUpdateHistoryWithPolicy[]>;
  };
}
