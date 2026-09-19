/**
 * Supabase Database Adapter
 * Wraps the existing Supabase client to conform to the DatabaseAdapter interface
 */

import { createServerClient } from '@/lib/supabase';
import type { DatabaseAdapter, PackagingJob, UploadHistoryRecord, JobStats } from './types';
import type {
  AppUpdatePolicy,
  AutoUpdateHistory,
  AutoUpdateHistoryWithPolicy,
} from '@/types/update-policies';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Type guard to check if a response is an error
 */
function isError(error: PostgrestError | null): error is PostgrestError {
  return error !== null;
}

function isMissingArchiveColumn(error: PostgrestError | null): boolean {
  return Boolean(error?.message?.includes('archived_at'));
}

/**
 * Helper type for query results
 */
interface QueryResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/**
 * Helper type for count query results
 */
interface CountResult {
  count: number | null;
  error: PostgrestError | null;
}

/**
 * Query builder interface for packaging_jobs table
 */
interface PackagingJobsSelectQuery {
  eq(column: string, value: string): PackagingJobsSelectQuery;
  lt(column: string, value: string): PackagingJobsSelectQuery;
  is(column: string, value: null): PackagingJobsSelectQuery;
  order(column: string, options: { ascending: boolean }): PackagingJobsSelectQuery;
  limit(count: number): PackagingJobsSelectQuery;
  single(): Promise<QueryResult<PackagingJob>>;
  then<T>(resolve: (result: QueryResult<PackagingJob[]> & CountResult) => T): Promise<T>;
}

interface PackagingJobsUpdateQuery {
  eq(column: string, value: string): PackagingJobsUpdateQuery;
  is(column: string, value: null): PackagingJobsUpdateQuery;
  select(): {
    single(): Promise<QueryResult<PackagingJob>>;
  };
}

interface PackagingJobsQueryBuilder {
  select(columns: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): PackagingJobsSelectQuery;
  insert(data: Partial<PackagingJob>): {
    select(): {
      single(): Promise<QueryResult<PackagingJob>>;
    };
  };
  update(data: Partial<PackagingJob>): PackagingJobsUpdateQuery;
}

/**
 * Query builder interface for upload_history table
 */
interface UploadHistorySelectQuery {
  eq(column: string, value: string): UploadHistorySelectQuery;
  order(column: string, options: { ascending: boolean }): UploadHistorySelectQuery;
  limit(count: number): UploadHistorySelectQuery;
  single(): Promise<QueryResult<UploadHistoryRecord>>;
  then<T>(resolve: (result: QueryResult<UploadHistoryRecord[]>) => T): Promise<T>;
}

interface UploadHistoryQueryBuilder {
  select(columns: string): UploadHistorySelectQuery;
  insert(data: Partial<UploadHistoryRecord>): {
    select(): {
      single(): Promise<QueryResult<UploadHistoryRecord>>;
    };
  };
}

/**
 * Get a typed query builder for packaging_jobs table
 */
function getPackagingJobsQuery(supabase: ReturnType<typeof createServerClient>): PackagingJobsQueryBuilder {
  // Type assertion is needed here due to Supabase client typing limitations
  // The Database type structure doesn't fully match what supabase-js expects
  return supabase.from('packaging_jobs') as unknown as PackagingJobsQueryBuilder;
}

/**
 * Get a typed query builder for upload_history table
 */
function getUploadHistoryQuery(supabase: ReturnType<typeof createServerClient>): UploadHistoryQueryBuilder {
  // Type assertion is needed here due to Supabase client typing limitations
  return supabase.from('upload_history') as unknown as UploadHistoryQueryBuilder;
}

/**
 * Supabase implementation of the database adapter
 */
export const supabaseDb: DatabaseAdapter = {
  jobs: {
    /**
     * Get jobs by status
     */
    async getByStatus(status: string, limit: number = 10, ascending: boolean = true): Promise<PackagingJob[]> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      const { data, error } = await query
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending })
        .limit(limit);

      if (isError(error)) {
        console.error('Error fetching jobs by status:', error);
        throw error;
      }

      return (data || []).filter((job) => !job.archived_at);
    },

    /**
     * Get a job by ID
     */
    async getById(id: string): Promise<PackagingJob | null> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      const { data, error } = await query
        .select('*')
        .eq('id', id)
        .single();

      if (isError(error)) {
        if (error.code === 'PGRST116') {
          // Not found
          return null;
        }
        console.error('Error fetching job by ID:', error);
        throw error;
      }

      return data;
    },

    /**
     * Get jobs by user ID
     * Auto-excludes terminal-state jobs older than 7 days
     */
    async getByUserId(userId: string, limit: number = 50): Promise<PackagingJob[]> {
      const supabase = createServerClient();

      // Return the most recent jobs for the user with no age cutoff, so the
      // Uploads (all activities) view shows older completed deployments too.
      const { data, error } = await supabase
        .from('packaging_jobs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (isError(error)) {
        console.error('Error fetching jobs by user ID:', error);
        throw error;
      }

      return ((data as unknown as PackagingJob[]) || []).filter((job) => !job.archived_at);
    },

    async getByTenantId(tenantId: string, limit: number = 50): Promise<PackagingJob[]> {
      const supabase = createServerClient();

      // Every user's jobs in this tenant, most recent first, no age cutoff.
      const { data, error } = await supabase
        .from('packaging_jobs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (isError(error)) {
        console.error('Error fetching jobs by tenant ID:', error);
        throw error;
      }

      return ((data as unknown as PackagingJob[]) || []).filter((job) => !job.archived_at);
    },

    /**
     * Create a new job
     */
    async create(job: Partial<PackagingJob>): Promise<PackagingJob> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      const insertData: Partial<PackagingJob> = {
        id: job.id || crypto.randomUUID(),
        user_id: job.user_id,
        user_email: job.user_email,
        tenant_id: job.tenant_id,
        winget_id: job.winget_id,
        version: job.version,
        display_name: job.display_name,
        publisher: job.publisher,
        architecture: job.architecture,
        installer_type: job.installer_type,
        installer_url: job.installer_url,
        installer_sha256: job.installer_sha256,
        install_command: job.install_command,
        uninstall_command: job.uninstall_command,
        install_scope: job.install_scope,
        detection_rules: job.detection_rules,
        package_config: job.package_config,
        app_source: job.app_source || 'win32',
        status: job.status || 'queued',
        status_message: job.status_message,
        progress_percent: job.progress_percent || 0,
        error_stage: job.error_stage,
        error_category: job.error_category,
        error_code: job.error_code,
        execution_profile_sha256: job.execution_profile_sha256,
        presentation_profile_sha256: job.presentation_profile_sha256,
        qa_candidate_id: job.qa_candidate_id,
        qa_requested_at: job.qa_requested_at,
        qa_completed_at: job.qa_completed_at,
      };

      const { data, error } = await query
        .insert(insertData)
        .select()
        .single();

      if (isError(error)) {
        console.error('Error creating job:', error);
        throw error;
      }

      if (!data) {
        throw new Error('No data returned from insert');
      }

      return data;
    },

    /**
     * Update a job
     */
    async update(id: string, updateData: Partial<PackagingJob>, conditions?: Record<string, unknown>): Promise<PackagingJob | null> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      // Build the update query
      let updateQuery = query.update(updateData).eq('id', id);

      // Apply additional conditions
      if (conditions) {
        for (const [key, value] of Object.entries(conditions)) {
          if (value === null) {
            updateQuery = updateQuery.is(key, null);
          } else {
            updateQuery = updateQuery.eq(key, value as string);
          }
        }
      }

      const { data: result, error } = await updateQuery.select().single();

      if (isError(error)) {
        // If no rows were updated (e.g., condition not met), return null
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('Error updating job:', error);
        throw error;
      }

      return result;
    },

    /**
     * Claim a job atomically (only if status is 'queued')
     */
    async claim(jobId: string, _packagerId: string): Promise<PackagingJob | null> {
      const now = new Date().toISOString();

      return this.update(
        jobId,
        {
          status: 'packaging',
          packaging_started_at: now,
        },
        { status: 'queued' }
      );
    },

    /**
     * Release a job back to queued state
     */
    async release(jobId: string, _packagerId: string): Promise<PackagingJob | null> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      const { data, error } = await query
        .update({
          status: 'queued',
          packaging_started_at: null,
        })
        .eq('id', jobId)
        .select()
        .single();

      if (isError(error)) {
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('Error releasing job:', error);
        throw error;
      }

      return data;
    },

    /**
     * Force release a stale job back to queued state (no packager_id check)
     */
    async forceRelease(jobId: string): Promise<PackagingJob | null> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      const { data, error } = await query
        .update({
          status: 'queued',
          packaging_started_at: null,
        })
        .eq('id', jobId)
        .select()
        .single();

      if (isError(error)) {
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('Error force releasing job:', error);
        throw error;
      }

      return data;
    },

    /**
     * Get stale jobs (packaging status with old heartbeat)
     */
    async getStaleJobs(staleThreshold: Date): Promise<PackagingJob[]> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      const { data, error } = await query
        .select('*')
        .eq('status', 'packaging')
        .lt('packaging_started_at', staleThreshold.toISOString());

      if (isError(error)) {
        console.error('Error fetching stale jobs:', error);
        throw error;
      }

      return data || [];
    },

    /**
     * Get job statistics
     */
    async getStats(): Promise<JobStats> {
      const supabase = createServerClient();
      const stats: JobStats = {
        queued: 0,
        packaging: 0,
        uploading: 0,
        deployed: 0,
        failed: 0,
        cancelled: 0,
      };

      // Fetch counts for each status
      for (const status of Object.keys(stats)) {
        const query = getPackagingJobsQuery(supabase);
        let { count, error } = await query
          .select('*', { count: 'exact', head: true })
          .eq('status', status)
          .is('archived_at', null);

        // Deploys can briefly run before migration 033 is applied. Keep reads
        // available during that window; archiving activates once the column exists.
        if (isMissingArchiveColumn(error)) {
          ({ count, error } = await getPackagingJobsQuery(supabase)
            .select('*', { count: 'exact', head: true })
            .eq('status', status));
        }

        if (!isError(error) && count !== null) {
          stats[status as keyof JobStats] = count;
        }
      }

      return stats;
    },

    /**
     * Soft-archive a single job by ID so upload-history references remain valid.
     */
    async deleteById(id: string): Promise<boolean> {
      const supabase = createServerClient();

      const { error } = await supabase
        .from('packaging_jobs')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id);

      if (isError(error)) {
        console.error('Error archiving job:', error);
        throw error;
      }

      return true;
    },

    /**
     * Bulk-archive jobs matching a user ID and a set of statuses.
     */
    async deleteByUserIdAndStatuses(userId: string, statuses: string[]): Promise<number> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('packaging_jobs')
        .update({ archived_at: new Date().toISOString() })
        .eq('user_id', userId)
        .in('status', statuses)
        .is('archived_at', null)
        .select('id');

      if (isError(error)) {
        console.error('Error bulk-archiving jobs:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },
  },

  uploadHistory: {
    /**
     * Create an upload history record
     */
    async create(record: Partial<UploadHistoryRecord>): Promise<UploadHistoryRecord> {
      const supabase = createServerClient();
      const query = getUploadHistoryQuery(supabase);

      const insertData: Partial<UploadHistoryRecord> = {
        id: record.id || crypto.randomUUID(),
        packaging_job_id: record.packaging_job_id,
        user_id: record.user_id,
        winget_id: record.winget_id,
        version: record.version,
        display_name: record.display_name,
        publisher: record.publisher,
        intune_app_id: record.intune_app_id,
        intune_app_url: record.intune_app_url,
        intune_tenant_id: record.intune_tenant_id,
        deployed_at: record.deployed_at || new Date().toISOString(),
      };

      const { data, error } = await query
        .insert(insertData)
        .select()
        .single();

      if (isError(error)) {
        console.error('Error creating upload history:', error);
        throw error;
      }

      if (!data) {
        throw new Error('No data returned from insert');
      }

      return data;
    },

    /**
     * Get upload history by user ID
     */
    async getByUserId(userId: string, limit: number = 50): Promise<UploadHistoryRecord[]> {
      const supabase = createServerClient();
      const query = getUploadHistoryQuery(supabase);

      const { data, error } = await query
        .select('*')
        .eq('user_id', userId)
        .order('deployed_at', { ascending: false })
        .limit(limit);

      if (isError(error)) {
        console.error('Error fetching upload history:', error);
        throw error;
      }

      return data || [];
    },
  },

  updatePolicies: {
    async list(userId: string, tenantId?: string): Promise<AppUpdatePolicy[]> {
      const supabase = createServerClient();
      let query = supabase.from('app_update_policies').select('*').eq('user_id', userId);
      if (tenantId) {
        query = query.eq('tenant_id', tenantId);
      }
      const { data, error } = await query.order('updated_at', { ascending: false });
      if (isError(error)) {
        console.error('Error listing update policies:', error);
        throw error;
      }
      return (data ?? []) as unknown as AppUpdatePolicy[];
    },

    async getById(id: string, userId: string): Promise<AppUpdatePolicy | null> {
      const supabase = createServerClient();
      const { data, error } = await supabase
        .from('app_update_policies')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (isError(error) && error.code !== 'PGRST116') {
        console.error('Error fetching update policy:', error);
        throw error;
      }
      return (data as unknown as AppUpdatePolicy) ?? null;
    },

    async getByKey(userId: string, tenantId: string, wingetId: string): Promise<AppUpdatePolicy | null> {
      const supabase = createServerClient();
      const { data, error } = await supabase
        .from('app_update_policies')
        .select('*')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .eq('winget_id', wingetId)
        .maybeSingle();
      if (isError(error) && error.code !== 'PGRST116') {
        console.error('Error fetching update policy:', error);
        throw error;
      }
      return (data as unknown as AppUpdatePolicy) ?? null;
    },

    async upsert(
      policy: Partial<AppUpdatePolicy> & Pick<AppUpdatePolicy, 'user_id' | 'tenant_id' | 'winget_id' | 'policy_type'>
    ): Promise<AppUpdatePolicy> {
      const supabase = createServerClient();
      const { data, error } = await supabase
        .from('app_update_policies')
        .upsert(
          {
            user_id: policy.user_id,
            tenant_id: policy.tenant_id,
            winget_id: policy.winget_id,
            policy_type: policy.policy_type,
            pinned_version: policy.pinned_version ?? null,
            deployment_config: (policy.deployment_config ?? null) as never,
            original_upload_history_id: policy.original_upload_history_id ?? null,
            is_enabled: policy.is_enabled ?? true,
            updated_at: policy.updated_at || new Date().toISOString(),
          },
          { onConflict: 'user_id,tenant_id,winget_id' }
        )
        .select()
        .single();

      if (isError(error)) {
        console.error('Error upserting update policy:', error);
        throw error;
      }
      if (!data) {
        throw new Error('No data returned from upsert');
      }
      return data as unknown as AppUpdatePolicy;
    },

    async update(id: string, userId: string, data: Partial<AppUpdatePolicy>): Promise<AppUpdatePolicy | null> {
      const supabase = createServerClient();
      const { data: updated, error } = await supabase
        .from('app_update_policies')
        .update({ ...data, updated_at: data.updated_at || new Date().toISOString() } as never)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .maybeSingle();
      if (isError(error) && error.code !== 'PGRST116') {
        console.error('Error updating update policy:', error);
        throw error;
      }
      return (updated as unknown as AppUpdatePolicy) ?? null;
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const supabase = createServerClient();
      const { count, error } = await supabase
        .from('app_update_policies')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('user_id', userId);
      if (isError(error)) {
        console.error('Error deleting update policy:', error);
        throw error;
      }
      return (count ?? 0) > 0;
    },
  },

  autoUpdateHistory: {
    async create(
      record: Partial<AutoUpdateHistory> &
        Pick<AutoUpdateHistory, 'policy_id' | 'from_version' | 'to_version' | 'update_type'>
    ): Promise<AutoUpdateHistory> {
      const supabase = createServerClient();
      const { data, error } = await supabase
        .from('auto_update_history')
        .insert({
          policy_id: record.policy_id,
          packaging_job_id: record.packaging_job_id ?? null,
          from_version: record.from_version,
          to_version: record.to_version,
          update_type: record.update_type,
          status: record.status ?? 'pending',
          error_message: record.error_message ?? null,
          triggered_at: record.triggered_at || new Date().toISOString(),
          completed_at: record.completed_at ?? null,
        })
        .select()
        .single();
      if (isError(error)) {
        console.error('Error creating auto-update history:', error);
        throw error;
      }
      if (!data) {
        throw new Error('No data returned from insert');
      }
      return data as unknown as AutoUpdateHistory;
    },

    async update(id: string, data: Partial<AutoUpdateHistory>): Promise<AutoUpdateHistory | null> {
      const supabase = createServerClient();
      const { data: updated, error } = await supabase
        .from('auto_update_history')
        .update(data as never)
        .eq('id', id)
        .select()
        .maybeSingle();
      if (isError(error) && error.code !== 'PGRST116') {
        console.error('Error updating auto-update history:', error);
        throw error;
      }
      return (updated as unknown as AutoUpdateHistory) ?? null;
    },

    async list(userId: string, query: Parameters<DatabaseAdapter['autoUpdateHistory']['list']>[1]): Promise<AutoUpdateHistoryWithPolicy[]> {
      const supabase = createServerClient();

      let policyQuery = supabase
        .from('app_update_policies')
        .select('id, winget_id, tenant_id')
        .eq('user_id', userId);
      if (query.tenantId) policyQuery = policyQuery.eq('tenant_id', query.tenantId);
      if (query.wingetId) policyQuery = policyQuery.eq('winget_id', query.wingetId);

      const { data: policies, error: policyError } = await policyQuery;
      if (isError(policyError)) {
        console.error('Error fetching update policy ids:', policyError);
        throw policyError;
      }
      const policyIds = (policies ?? []).map((policy) => policy.id);
      if (policyIds.length === 0) {
        return [];
      }

      let historyQuery = supabase
        .from('auto_update_history')
        .select(
          `*, policy:app_update_policies!policy_id(winget_id, tenant_id), packaging_job:packaging_jobs!packaging_job_id(display_name)`
        )
        .in('policy_id', policyIds)
        .order('triggered_at', { ascending: false })
        .range(query.offset, query.offset + query.limit - 1);
      if (query.status) historyQuery = historyQuery.eq('status', query.status);

      const { data, error } = await historyQuery;
      if (isError(error)) {
        console.error('Error listing auto-update history:', error);
        throw error;
      }

      interface JoinedHistory extends AutoUpdateHistory {
        policy: { winget_id: string; tenant_id: string } | null;
        packaging_job: { display_name: string } | null;
      }
      return ((data ?? []) as unknown as JoinedHistory[]).map((row) => ({
        id: row.id,
        policy_id: row.policy_id,
        packaging_job_id: row.packaging_job_id,
        from_version: row.from_version,
        to_version: row.to_version,
        update_type: row.update_type,
        status: row.status,
        error_message: row.error_message,
        triggered_at: row.triggered_at,
        completed_at: row.completed_at,
        policy: {
          winget_id: row.policy?.winget_id ?? '',
          tenant_id: row.policy?.tenant_id ?? '',
        },
        display_name: row.packaging_job?.display_name,
      }));
    },
  },
};
