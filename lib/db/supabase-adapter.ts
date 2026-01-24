/**
 * Supabase Database Adapter
 * Wraps the existing Supabase client to conform to the DatabaseAdapter interface
 */

import { createServerClient } from '@/lib/supabase';
import type { DatabaseAdapter, PackagingJob, UploadHistoryRecord, JobStats } from './types';

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('packaging_jobs')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending })
        .limit(limit);

      if (error) {
        console.error('Error fetching jobs by status:', error);
        throw error;
      }

      return (data || []) as PackagingJob[];
    },

    /**
     * Get a job by ID
     */
    async getById(id: string): Promise<PackagingJob | null> {
      const supabase = createServerClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('packaging_jobs')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Not found
          return null;
        }
        console.error('Error fetching job by ID:', error);
        throw error;
      }

      return data as PackagingJob;
    },

    /**
     * Get jobs by user ID
     */
    async getByUserId(userId: string, limit: number = 50): Promise<PackagingJob[]> {
      const supabase = createServerClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('packaging_jobs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching jobs by user ID:', error);
        throw error;
      }

      return (data || []) as PackagingJob[];
    },

    /**
     * Create a new job
     */
    async create(job: Partial<PackagingJob>): Promise<PackagingJob> {
      const supabase = createServerClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('packaging_jobs')
        .insert({
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
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating job:', error);
        throw error;
      }

      return data as PackagingJob;
    },

    /**
     * Update a job
     */
    async update(id: string, data: Partial<PackagingJob>, conditions?: Record<string, unknown>): Promise<PackagingJob | null> {
      const supabase = createServerClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase as any)
        .from('packaging_jobs')
        .update(data)
        .eq('id', id);

      // Apply additional conditions
      if (conditions) {
        for (const [key, value] of Object.entries(conditions)) {
          if (value === null) {
            query = query.is(key, null);
          } else {
            query = query.eq(key, value);
          }
        }
      }

      const { data: result, error } = await query.select().single();

      if (error) {
        // If no rows were updated (e.g., condition not met), return null
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('Error updating job:', error);
        throw error;
      }

      return result as PackagingJob;
    },

    /**
     * Claim a job atomically (only if status is 'queued')
     */
    async claim(jobId: string, packagerId: string): Promise<PackagingJob | null> {
      const now = new Date().toISOString();

      return this.update(
        jobId,
        {
          status: 'packaging',
          packager_id: packagerId,
          packager_heartbeat_at: now,
          claimed_at: now,
          packaging_started_at: now,
        },
        { status: 'queued' }
      );
    },

    /**
     * Release a job back to queued state
     */
    async release(jobId: string, packagerId: string): Promise<PackagingJob | null> {
      const supabase = createServerClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('packaging_jobs')
        .update({
          status: 'queued',
          packager_id: null,
          packager_heartbeat_at: null,
          claimed_at: null,
          packaging_started_at: null,
        })
        .eq('id', jobId)
        .eq('packager_id', packagerId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('Error releasing job:', error);
        throw error;
      }

      return data as PackagingJob;
    },

    /**
     * Force release a stale job back to queued state (no packager_id check)
     */
    async forceRelease(jobId: string): Promise<PackagingJob | null> {
      const supabase = createServerClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('packaging_jobs')
        .update({
          status: 'queued',
          packager_id: null,
          packager_heartbeat_at: null,
          claimed_at: null,
          packaging_started_at: null,
        })
        .eq('id', jobId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('Error force releasing job:', error);
        throw error;
      }

      return data as PackagingJob;
    },

    /**
     * Get stale jobs (packaging status with old heartbeat)
     */
    async getStaleJobs(staleThreshold: Date): Promise<PackagingJob[]> {
      const supabase = createServerClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('packaging_jobs')
        .select('*')
        .eq('status', 'packaging')
        .lt('packager_heartbeat_at', staleThreshold.toISOString());

      if (error) {
        console.error('Error fetching stale jobs:', error);
        throw error;
      }

      return (data || []) as PackagingJob[];
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { count, error } = await (supabase as any)
          .from('packaging_jobs')
          .select('*', { count: 'exact', head: true })
          .eq('status', status);

        if (!error && count !== null) {
          stats[status as keyof JobStats] = count;
        }
      }

      return stats;
    },
  },

  uploadHistory: {
    /**
     * Create an upload history record
     */
    async create(record: Partial<UploadHistoryRecord>): Promise<UploadHistoryRecord> {
      const supabase = createServerClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('upload_history')
        .insert({
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
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating upload history:', error);
        throw error;
      }

      return data as UploadHistoryRecord;
    },

    /**
     * Get upload history by user ID
     */
    async getByUserId(userId: string, limit: number = 50): Promise<UploadHistoryRecord[]> {
      const supabase = createServerClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('upload_history')
        .select('*')
        .eq('user_id', userId)
        .order('deployed_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching upload history:', error);
        throw error;
      }

      return (data || []) as UploadHistoryRecord[];
    },
  },
};
