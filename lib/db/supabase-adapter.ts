/**
 * Supabase Database Adapter
 * Wraps the existing Supabase client to conform to the DatabaseAdapter interface
 */

import { createServerClient } from '@/lib/supabase';
import type { DatabaseAdapter, PackagingJob, UploadHistoryRecord, JobStats } from './types';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Type guard to check if a response is an error
 */
function isError(error: PostgrestError | null): error is PostgrestError {
  return error !== null;
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

      return data || [];
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
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const terminalStatuses = ['completed', 'deployed', 'failed', 'cancelled', 'duplicate_skipped'];
      const activeStatuses = ['queued', 'packaging', 'testing', 'uploading'];

      // Fetch jobs: either active (any age) or terminal within last 7 days
      const { data, error } = await supabase
        .from('packaging_jobs')
        .select('*')
        .eq('user_id', userId)
        .or(`status.in.(${activeStatuses.join(',')}),created_at.gte.${sevenDaysAgo}`)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (isError(error)) {
        console.error('Error fetching jobs by user ID:', error);
        throw error;
      }

      return (data as unknown as PackagingJob[]) || [];
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
        status: job.status || 'queued',
        progress_percent: job.progress_percent || 0,
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
        testing: 0,
        uploading: 0,
        deployed: 0,
        failed: 0,
        cancelled: 0,
      };

      // Fetch counts for each status
      for (const status of Object.keys(stats)) {
        const query = getPackagingJobsQuery(supabase);
        const { count, error } = await query
          .select('*', { count: 'exact', head: true })
          .eq('status', status);

        if (!isError(error) && count !== null) {
          stats[status as keyof JobStats] = count;
        }
      }

      return stats;
    },

    /**
     * Delete a single job by ID.
     * Clears FK references in msp_batch_deployment_items before deleting.
     */
    async deleteById(id: string): Promise<boolean> {
      const supabase = createServerClient();

      // Clear FK reference in msp_batch_deployment_items (no ON DELETE clause)
      await supabase
        .from('msp_batch_deployment_items')
        .update({ packaging_job_id: null })
        .eq('packaging_job_id', id);

      const { error } = await supabase
        .from('packaging_jobs')
        .delete()
        .eq('id', id);

      if (isError(error)) {
        console.error('Error deleting job:', error);
        throw error;
      }

      return true;
    },

    /**
     * Bulk-delete jobs matching a user ID and a set of statuses.
     * Clears FK references in msp_batch_deployment_items before deleting.
     */
    async deleteByUserIdAndStatuses(userId: string, statuses: string[]): Promise<number> {
      const supabase = createServerClient();

      // Find IDs to delete first
      const { data: jobsToDelete, error: fetchError } = await supabase
        .from('packaging_jobs')
        .select('id')
        .eq('user_id', userId)
        .in('status', statuses);

      if (isError(fetchError)) {
        console.error('Error fetching jobs for deletion:', fetchError);
        throw fetchError;
      }

      const jobIds = (jobsToDelete as unknown as Array<{ id: string }>)?.map((j) => j.id) ?? [];
      if (jobIds.length === 0) return 0;

      // Clear FK references in msp_batch_deployment_items
      await supabase
        .from('msp_batch_deployment_items')
        .update({ packaging_job_id: null })
        .in('packaging_job_id', jobIds);

      // Now delete the jobs
      const { data, error } = await supabase
        .from('packaging_jobs')
        .delete()
        .eq('user_id', userId)
        .in('status', statuses)
        .select('id');

      if (isError(error)) {
        console.error('Error bulk-deleting jobs:', error);
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
};
