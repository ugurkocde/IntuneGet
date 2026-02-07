/**
 * Job Poller - Polls for queued jobs and handles claiming
 * Supports both direct Supabase access and HTTP API communication
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PackagerConfig } from './config.js';
import { createLogger, Logger } from './logger.js';
import { ApiClient } from './api-client.js';

export interface PackagingJob {
  id: string;
  user_id: string;
  user_email: string;
  tenant_id: string;
  winget_id: string;
  version: string;
  display_name: string;
  publisher: string;
  architecture: string;
  installer_type: string;
  installer_url: string;
  installer_sha256: string;
  install_command: string;
  uninstall_command: string;
  install_scope: string;
  detection_rules: unknown[];
  package_config: unknown;
  status: string;
  progress_percent: number;
  progress_message?: string;
  error_message?: string;
  packager_id?: string;
  packager_heartbeat_at?: string;
  claimed_at?: string;
  created_at: string;
}

export interface JobClaimResult {
  claimed: boolean;
  job?: PackagingJob;
  error?: string;
}

export type JobHandler = (job: PackagingJob) => Promise<void>;

export class JobPoller {
  private supabase: SupabaseClient | null = null;
  private apiClient: ApiClient | null = null;
  private config: PackagerConfig;
  private logger: Logger;
  private isRunning: boolean = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private currentJobId: string | null = null;

  constructor(config: PackagerConfig) {
    this.config = config;
    this.logger = createLogger('JobPoller');

    // Initialize the appropriate client based on mode
    if (config.mode === 'api') {
      this.apiClient = new ApiClient(config);
      this.logger.info('Using HTTP API mode');
    } else {
      this.supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      this.logger.info('Using Supabase mode');
    }
  }

  /**
   * Start polling for jobs
   */
  async start(handler: JobHandler): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Poller already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting job poller', {
      packagerId: this.config.packagerId,
      pollInterval: this.config.polling.interval,
    });

    // Initial poll
    await this.poll(handler);

    // Schedule recurring polls
    this.schedulePoll(handler);
  }

  /**
   * Stop polling
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    this.logger.info('Job poller stopped');
  }

  /**
   * Schedule the next poll
   */
  private schedulePoll(handler: JobHandler): void {
    if (!this.isRunning) return;

    this.pollTimeout = setTimeout(async () => {
      await this.poll(handler);
      this.schedulePoll(handler);
    }, this.config.polling.interval);
  }

  /**
   * Poll for a job and process it
   */
  private async poll(handler: JobHandler): Promise<void> {
    // Skip if already processing a job
    if (this.currentJobId) {
      this.logger.debug('Skipping poll - already processing job', { jobId: this.currentJobId });
      return;
    }

    try {
      // First, recover any stale jobs (claimed but no recent heartbeat)
      await this.recoverStaleJobs();

      // Try to claim a queued job
      const result = await this.claimNextJob();

      if (result.claimed && result.job) {
        this.currentJobId = result.job.id;
        this.logger.info('Claimed job', {
          jobId: result.job.id,
          wingetId: result.job.winget_id,
          displayName: result.job.display_name,
        });

        try {
          // Start heartbeat
          const heartbeatInterval = this.startHeartbeat(result.job.id);

          // Process the job
          await handler(result.job);

          // Stop heartbeat
          clearInterval(heartbeatInterval);
        } catch (error) {
          this.logger.error('Job processing failed', {
            jobId: result.job.id,
            error: error instanceof Error ? error.message : String(error),
          });

          // Mark job as failed
          await this.updateJobStatus(result.job.id, 'failed', {
            error_message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          this.currentJobId = null;
        }
      }
    } catch (error) {
      this.logger.error('Poll error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Claim the next available queued job
   */
  private async claimNextJob(): Promise<JobClaimResult> {
    // Use API client if in API mode
    if (this.apiClient) {
      return this.claimNextJobViaApi();
    }

    // Otherwise use Supabase directly
    return this.claimNextJobViaSupabase();
  }

  /**
   * Claim next job via HTTP API
   */
  private async claimNextJobViaApi(): Promise<JobClaimResult> {
    try {
      // Get queued jobs
      const jobs = await this.apiClient!.getQueuedJobs(1);

      if (jobs.length === 0) {
        this.logger.debug('No queued jobs available');
        return { claimed: false };
      }

      const job = jobs[0];

      // Try to claim the job
      const result = await this.apiClient!.claimJob(job.id);

      if (!result.claimed) {
        this.logger.debug('Failed to claim job (likely claimed by another packager)', {
          jobId: job.id,
        });
        return { claimed: false };
      }

      return { claimed: true, job: result.job };
    } catch (error) {
      this.logger.error('Failed to claim job via API', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { claimed: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Claim next job via Supabase
   */
  private async claimNextJobViaSupabase(): Promise<JobClaimResult> {
    // Get the oldest queued job
    const { data: jobs, error: fetchError } = await this.supabase!
      .from('packaging_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1);

    if (fetchError) {
      this.logger.error('Failed to fetch queued jobs', { error: fetchError.message });
      return { claimed: false, error: fetchError.message };
    }

    if (!jobs || jobs.length === 0) {
      this.logger.debug('No queued jobs available');
      return { claimed: false };
    }

    const job = jobs[0] as PackagingJob;
    const now = new Date().toISOString();

    // Atomically claim the job (only if still queued)
    const { data: claimedJob, error: claimError } = await this.supabase!
      .from('packaging_jobs')
      .update({
        status: 'packaging',
        packager_id: this.config.packagerId,
        packager_heartbeat_at: now,
        claimed_at: now,
        packaging_started_at: now,
      })
      .eq('id', job.id)
      .eq('status', 'queued') // Only claim if still queued
      .select()
      .single();

    if (claimError) {
      // Job was already claimed by another packager
      this.logger.debug('Failed to claim job (likely claimed by another packager)', {
        jobId: job.id,
      });
      return { claimed: false };
    }

    return { claimed: true, job: claimedJob as PackagingJob };
  }

  /**
   * Recover jobs that were claimed but haven't received a heartbeat
   * Note: In API mode, the web app handles stale job recovery
   */
  private async recoverStaleJobs(): Promise<void> {
    // In API mode, stale job recovery is handled by the web app
    if (this.apiClient) {
      this.logger.debug('Stale job recovery is handled by the web app in API mode');
      return;
    }

    const staleThreshold = new Date(Date.now() - this.config.polling.staleJobTimeout).toISOString();

    // Find stale jobs (packaging status with old heartbeat)
    const { data: staleJobs, error } = await this.supabase!
      .from('packaging_jobs')
      .select('id, packager_id, winget_id')
      .eq('status', 'packaging')
      .lt('packager_heartbeat_at', staleThreshold);

    if (error) {
      this.logger.error('Failed to check for stale jobs', { error: error.message });
      return;
    }

    if (staleJobs && staleJobs.length > 0) {
      this.logger.warn(`Found ${staleJobs.length} stale job(s), recovering...`);

      for (const job of staleJobs) {
        const { error: resetError } = await this.supabase!
          .from('packaging_jobs')
          .update({
            status: 'queued',
            packager_id: null,
            packager_heartbeat_at: null,
            claimed_at: null,
            packaging_started_at: null,
          })
          .eq('id', job.id);

        if (resetError) {
          this.logger.error('Failed to recover stale job', {
            jobId: job.id,
            error: resetError.message,
          });
        } else {
          this.logger.info('Recovered stale job', {
            jobId: job.id,
            wingetId: job.winget_id,
            previousPackager: job.packager_id,
          });
        }
      }
    }
  }

  /**
   * Start sending heartbeats for a job
   */
  private startHeartbeat(jobId: string): NodeJS.Timeout {
    const heartbeatInterval = Math.floor(this.config.polling.staleJobTimeout / 3);

    return setInterval(async () => {
      await this.sendHeartbeat(jobId);
    }, heartbeatInterval);
  }

  /**
   * Send a heartbeat for the current job
   */
  async sendHeartbeat(jobId: string): Promise<void> {
    if (this.apiClient) {
      try {
        await this.apiClient.sendHeartbeat(jobId);
      } catch (error) {
        this.logger.warn('Failed to send heartbeat via API', {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    const { error } = await this.supabase!
      .from('packaging_jobs')
      .update({
        packager_heartbeat_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('packager_id', this.config.packagerId);

    if (error) {
      this.logger.warn('Failed to send heartbeat', { jobId, error: error.message });
    }
  }

  /**
   * Update job status
   */
  async updateJobStatus(
    jobId: string,
    status: string,
    additionalData?: Record<string, unknown>
  ): Promise<void> {
    if (this.apiClient) {
      try {
        await this.apiClient.updateStatus(jobId, status, {
          error: additionalData?.error_message as string | undefined,
          intuneAppId: additionalData?.intune_app_id as string | undefined,
          intuneAppUrl: additionalData?.intune_app_url as string | undefined,
        });
        this.logger.info('Job status updated via API', { jobId, status });
      } catch (error) {
        this.logger.error('Failed to update job status via API', {
          jobId,
          status,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      return;
    }

    const { data: existingJob, error: existingJobError } = await this.supabase!
      .from('packaging_jobs')
      .select('status')
      .eq('id', jobId)
      .single();

    if (existingJobError) {
      this.logger.warn('Could not read existing job status before update', {
        jobId,
        error: existingJobError.message,
      });
    }

    const updateData: Record<string, unknown> = {
      status,
      packager_heartbeat_at: new Date().toISOString(),
    };

    if (status === 'uploading') {
      updateData.upload_started_at = new Date().toISOString();
      updateData.packaging_completed_at = new Date().toISOString();
    } else if (status === 'deployed' || status === 'failed') {
      updateData.completed_at = new Date().toISOString();
    }

    if (additionalData) {
      Object.assign(updateData, additionalData);
    }

    const { data: updatedJob, error } = await this.supabase!
      .from('packaging_jobs')
      .update(updateData)
      .eq('id', jobId)
      .eq('packager_id', this.config.packagerId)
      .select('id, user_id, winget_id, version, display_name, publisher, tenant_id, intune_app_id, intune_app_url')
      .single();

    if (error) {
      this.logger.error('Failed to update job status', {
        jobId,
        status,
        error: error.message,
      });
      throw error;
    }

    if (
      status === 'deployed' &&
      existingJob?.status !== 'deployed' &&
      updatedJob?.intune_app_id
    ) {
      const { error: uploadHistoryError } = await this.supabase!
        .from('upload_history')
        .insert({
          packaging_job_id: updatedJob.id,
          user_id: updatedJob.user_id,
          winget_id: updatedJob.winget_id,
          version: updatedJob.version,
          display_name: updatedJob.display_name,
          publisher: updatedJob.publisher,
          intune_app_id: updatedJob.intune_app_id,
          intune_app_url: updatedJob.intune_app_url,
          intune_tenant_id: updatedJob.tenant_id,
        });

      if (uploadHistoryError) {
        this.logger.warn('Failed to write upload_history after deployment', {
          jobId,
          error: uploadHistoryError.message,
        });
      }
    }

    this.logger.info('Job status updated', { jobId, status });
  }

  /**
   * Update job progress
   */
  async updateJobProgress(
    jobId: string,
    percent: number,
    message?: string
  ): Promise<void> {
    if (this.apiClient) {
      try {
        await this.apiClient.updateProgress(jobId, percent, message);
      } catch (error) {
        this.logger.warn('Failed to update job progress via API', {
          jobId,
          percent,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    const updateData: Record<string, unknown> = {
      progress_percent: percent,
      packager_heartbeat_at: new Date().toISOString(),
    };

    if (message) {
      updateData.progress_message = message;
    }

    const { error } = await this.supabase!
      .from('packaging_jobs')
      .update(updateData)
      .eq('id', jobId)
      .eq('packager_id', this.config.packagerId);

    if (error) {
      this.logger.warn('Failed to update job progress', {
        jobId,
        percent,
        error: error.message,
      });
    }
  }
}
