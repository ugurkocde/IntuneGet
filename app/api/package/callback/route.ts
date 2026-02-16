/**
 * Package Callback API Route
 * Receives results from GitHub Actions packaging workflow
 * Protected by HMAC-SHA256 signature verification
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyCallbackSignature } from '@/lib/callback-signature';
import { onJobCompleted } from '@/lib/msp/batch-orchestrator';

interface PackageCallbackBody {
  jobId: string;
  status: 'packaging' | 'testing' | 'uploading' | 'deployed' | 'failed' | 'duplicate_skipped';
  message?: string;
  progress?: number;

  // Success fields (deployed / duplicate_skipped status)
  intuneAppId?: string;
  intuneAppUrl?: string;

  // Duplicate detection fields
  duplicateInfo?: {
    matchType: 'exact' | 'partial';
    existingAppId: string;
    existingVersion?: string;
    createdAt?: string;
  };

  // GitHub Actions run info
  runId?: string;
  runUrl?: string;

  // Enhanced error fields
  errorStage?: 'download' | 'package' | 'test' | 'upload' | 'authenticate' | 'finalize' | 'unknown';
  errorCategory?: 'network' | 'validation' | 'permission' | 'installer' | 'intune_api' | 'system';
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    // Read the raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get('X-Signature');
    const callbackSecret = process.env.CALLBACK_SECRET;

    // Verify HMAC signature
    if (callbackSecret) {
      if (!verifyCallbackSignature(body, signature, callbackSecret)) {
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        );
      }
    }

    // Parse the verified body
    const data: PackageCallbackBody = JSON.parse(body);

    // Validate required fields
    if (!data.jobId) {
      return NextResponse.json(
        { error: 'jobId is required' },
        { status: 400 }
      );
    }

    if (!data.status) {
      return NextResponse.json(
        { error: 'status is required' },
        { status: 400 }
      );
    }

    const db = getDatabase();

    // Build update object based on status
    const updateData: Record<string, unknown> = {
      status: data.status,
      status_message: data.message,
    };

    if (data.progress !== undefined) {
      updateData.progress_percent = data.progress;
    }

    // Add GitHub run info if provided
    if (data.runId) {
      updateData.github_run_id = data.runId;
    }
    if (data.runUrl) {
      updateData.github_run_url = data.runUrl;
    }

    // Handle deployed status
    if (data.status === 'deployed') {
      updateData.intune_app_id = data.intuneAppId;
      updateData.intune_app_url = data.intuneAppUrl;
      updateData.completed_at = new Date().toISOString();
      updateData.progress_percent = 100;

      // Get job details for upload history
      const job = await db.jobs.getById(data.jobId);

      if (job && data.intuneAppId) {
        // Add to upload history
        await db.uploadHistory.create({
          packaging_job_id: data.jobId,
          user_id: job.user_id,
          winget_id: job.winget_id,
          version: job.version,
          display_name: job.display_name,
          publisher: job.publisher,
          intune_app_id: data.intuneAppId,
          intune_app_url: data.intuneAppUrl,
          intune_tenant_id: job.tenant_id,
        });
      }
    }

    // Handle duplicate_skipped status
    if (data.status === 'duplicate_skipped') {
      updateData.intune_app_id = data.intuneAppId;
      updateData.intune_app_url = data.intuneAppUrl;
      updateData.completed_at = new Date().toISOString();
      updateData.progress_percent = 100;

      // Store duplicate info in error_details for UI display
      if (data.duplicateInfo) {
        updateData.error_details = data.duplicateInfo;
      }

      // Do NOT create uploadHistory record (no new app was created)
    }

    // Handle failure
    if (data.status === 'failed') {
      updateData.error_message = data.message || 'Unknown error';
      updateData.completed_at = new Date().toISOString();

      // Save enhanced error fields if provided
      if (data.errorStage) {
        updateData.error_stage = data.errorStage;
      }
      if (data.errorCategory) {
        updateData.error_category = data.errorCategory;
      }
      if (data.errorCode) {
        updateData.error_code = data.errorCode;
      }
      if (data.errorDetails) {
        updateData.error_details = data.errorDetails;
      }

      console.error(`Job ${data.jobId} failed: ${data.message}`, {
        stage: data.errorStage,
        category: data.errorCategory,
        code: data.errorCode,
      });
    }

    // Update the job in database
    const updatedJob = await db.jobs.update(data.jobId, updateData);

    if (!updatedJob) {
      return NextResponse.json(
        { error: 'Failed to update job status' },
        { status: 500 }
      );
    }

    // Check if this job belongs to a batch deployment item
    if (data.status === 'deployed' || data.status === 'failed' || data.status === 'duplicate_skipped') {
      const jobStatus = data.status === 'failed' ? 'failed' : 'completed';
      // Fire and forget - don't block the callback response
      onJobCompleted(data.jobId, jobStatus, data.message).catch((err) => {
        console.error('[Callback] Batch orchestrator error:', err);
      });
    }

    return NextResponse.json({
      success: true,
      job: updatedJob,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET handler for health check / verification
 */
export async function GET() {
  const databaseMode = process.env.DATABASE_MODE || 'supabase';

  const healthInfo: Record<string, unknown> = {
    status: 'ok',
    message: 'Package callback endpoint is active',
    signatureRequired: Boolean(process.env.CALLBACK_SECRET),
    databaseMode,
    timestamp: new Date().toISOString(),
  };

  // Check configuration status
  const configStatus = {
    callbackSecret: Boolean(process.env.CALLBACK_SECRET),
    databaseMode,
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    packagerApiKey: Boolean(process.env.PACKAGER_API_KEY),
    publicUrl: process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL || 'not configured',
  };
  healthInfo.configuration = configStatus;

  // Try to get job stats from database
  try {
    const db = getDatabase();
    const stats = await db.jobs.getStats();

    healthInfo.jobStats = stats;
    healthInfo.databaseConnected = true;
  } catch {
    healthInfo.databaseConnected = false;
  }

  return NextResponse.json(healthInfo);
}
