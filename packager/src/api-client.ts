/**
 * API Client for HTTP-based communication with the web app
 * Used when running in API mode (instead of direct Supabase access)
 */

import { PackagerConfig } from './config.js';
import { createLogger, Logger } from './logger.js';

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

export interface JobUpdateResult {
  updated: boolean;
  job?: PackagingJob;
  error?: string;
}

/**
 * HTTP API client for communicating with the IntuneGet web app
 * Replaces direct Supabase access for self-hosted deployments
 */
export class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  private packagerId: string;
  private logger: Logger;

  constructor(config: PackagerConfig) {
    if (!config.api?.url) {
      throw new Error('API URL is required (INTUNEGET_API_URL)');
    }
    if (!config.api?.key) {
      throw new Error('API key is required (PACKAGER_API_KEY)');
    }

    this.baseUrl = config.api.url.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.api.key;
    this.packagerId = config.packagerId;
    this.logger = createLogger('ApiClient');

    this.logger.info('API client initialized', {
      baseUrl: this.baseUrl,
      packagerId: this.packagerId,
    });
  }

  /**
   * Make an authenticated HTTP request to the API
   */
  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    this.logger.debug('API request', { method, path });

    const response = await fetch(url, options);
    const data = await response.json() as T & { error?: string };

    if (!response.ok) {
      this.logger.error('API request failed', {
        method,
        path,
        status: response.status,
        error: data.error,
      });
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data as T;
  }

  /**
   * Get queued jobs from the API
   */
  async getQueuedJobs(limit: number = 1): Promise<PackagingJob[]> {
    const response = await this.request<{ jobs: PackagingJob[] }>(
      'GET',
      `/api/packager/jobs?limit=${limit}&status=queued`
    );
    return response.jobs || [];
  }

  /**
   * Claim a job for processing
   */
  async claimJob(jobId: string): Promise<JobClaimResult> {
    try {
      const response = await this.request<{ claimed: boolean; job?: PackagingJob }>(
        'POST',
        '/api/packager/jobs',
        {
          jobId,
          packagerId: this.packagerId,
        }
      );
      return {
        claimed: response.claimed,
        job: response.job,
      };
    } catch (error) {
      return {
        claimed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update job status and progress
   */
  async updateJob(
    jobId: string,
    updates: {
      status?: string;
      progressPercent?: number;
      progressMessage?: string;
      error?: string;
      intuneAppId?: string;
      intuneAppUrl?: string;
    }
  ): Promise<JobUpdateResult> {
    try {
      const response = await this.request<{ updated: boolean; job?: PackagingJob }>(
        'PATCH',
        '/api/packager/jobs',
        {
          jobId,
          packagerId: this.packagerId,
          ...updates,
        }
      );
      return {
        updated: response.updated,
        job: response.job,
      };
    } catch (error) {
      return {
        updated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send heartbeat for a job
   */
  async sendHeartbeat(jobId: string): Promise<void> {
    await this.updateJob(jobId, {});
  }

  /**
   * Update job progress
   */
  async updateProgress(jobId: string, percent: number, message?: string): Promise<void> {
    await this.updateJob(jobId, {
      progressPercent: percent,
      progressMessage: message,
    });
  }

  /**
   * Update job status
   */
  async updateStatus(
    jobId: string,
    status: string,
    additionalData?: {
      error?: string;
      intuneAppId?: string;
      intuneAppUrl?: string;
    }
  ): Promise<void> {
    await this.updateJob(jobId, {
      status,
      ...additionalData,
    });
  }

  /**
   * Release a claimed job back to the queue
   */
  async releaseJob(jobId: string): Promise<boolean> {
    try {
      const response = await this.request<{ released: boolean }>(
        'DELETE',
        `/api/packager/jobs?jobId=${jobId}&packagerId=${this.packagerId}`
      );
      return response.released;
    } catch (error) {
      this.logger.error('Failed to release job', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
