/**
 * Package Callback API Route
 * Receives results from GitHub Actions packaging workflow
 * Protected by HMAC-SHA256 signature verification
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyCallbackSignature } from '@/lib/callback-signature';
import { onJobCompleted } from '@/lib/msp/batch-orchestrator';
import { handleAutoUpdateJobCompletion } from '@/lib/auto-update/cleanup';
import {
  packageCallbackSchema,
  sanitizeErrorDetails,
  shouldApplyCallback,
} from '@/lib/package-callback';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('X-Signature');
    const callbackSecret = process.env.CALLBACK_SECRET;

    if (!callbackSecret && process.env.NODE_ENV === 'production') {
      console.error('[Callback] CALLBACK_SECRET is required in production');
      return NextResponse.json({ error: 'Callback verification is unavailable' }, { status: 503 });
    }

    if (callbackSecret && !verifyCallbackSignature(body, signature, callbackSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = packageCallbackSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid callback payload', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const data = parsed.data;
    const db = getDatabase();
    const currentJob = await db.jobs.getById(data.jobId);
    if (!currentJob) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (!shouldApplyCallback(currentJob.status, data.status, currentJob.updated_at, data.heartbeatAt)) {
      return NextResponse.json({
        success: true,
        ignored: true,
        reason: 'stale_or_terminal_callback',
        job: currentJob,
      });
    }

    const updateData: Partial<typeof currentJob> = {
      status: data.status,
      status_message: data.message ?? currentJob.status_message,
    };

    if (data.progress !== undefined) {
      updateData.progress_percent = data.progress;
    }

    if (data.runId) {
      updateData.github_run_id = String(data.runId);
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

      if (data.warnings && data.warnings.length > 0) {
        updateData.warnings = data.warnings;
      }
    }

    // Handle duplicate_skipped status
    if (data.status === 'duplicate_skipped') {
      updateData.intune_app_id = data.intuneAppId;
      updateData.intune_app_url = data.intuneAppUrl;
      updateData.completed_at = new Date().toISOString();
      updateData.progress_percent = 100;

      if (data.duplicateInfo) {
        updateData.error_details = data.duplicateInfo;
      }
    }

    // Handle failure
    if (data.status === 'failed') {
      updateData.error_message = data.message || 'Unknown error';
      updateData.completed_at = new Date().toISOString();

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
        updateData.error_details = {
          ...sanitizeErrorDetails(data.errorDetails),
          retryable: data.retryable,
          retryAfterSeconds: data.retryAfterSeconds,
        };
      }

      console.error(`Job ${data.jobId} failed: ${data.message}`, {
        stage: data.errorStage,
        category: data.errorCategory,
        code: data.errorCode,
      });
    }

    // Optimistic status condition prevents a cancellation or another terminal
    // callback from being overwritten between the read and the update.
    const updatedJob = await db.jobs.update(data.jobId, updateData, { status: currentJob.status });

    if (!updatedJob) {
      const latestJob = await db.jobs.getById(data.jobId);
      return NextResponse.json({
        success: true,
        ignored: true,
        reason: 'job_changed_during_callback',
        job: latestJob,
      });
    }

    // Side effects run only after the state transition succeeds, making callback
    // retries idempotent and preventing duplicate history rows.
    if (data.status === 'deployed' && data.intuneAppId) {
      try {
        await db.uploadHistory.create({
          packaging_job_id: data.jobId,
          user_id: currentJob.user_id,
          winget_id: currentJob.winget_id,
          version: currentJob.version,
          display_name: currentJob.display_name,
          publisher: currentJob.publisher,
          intune_app_id: data.intuneAppId,
          intune_app_url: data.intuneAppUrl,
          intune_tenant_id: currentJob.tenant_id,
        });
      } catch (historyError) {
        // The terminal job state is authoritative. Do not ask the workflow to
        // retry a callback that can no longer repeat this side effect.
        console.error(`[Callback] Failed to create upload history for ${data.jobId}:`, historyError);
      }
    }

    // Check if this job belongs to a batch deployment item
    if (data.status === 'deployed' || data.status === 'failed' || data.status === 'duplicate_skipped') {
      const jobStatus = data.status === 'failed' ? 'failed' : 'completed';
      onJobCompleted(data.jobId, jobStatus, data.message).catch((err) => {
        console.error('[Callback] Batch orchestrator error:', err);
      });

      handleAutoUpdateJobCompletion(data.jobId, data.status, data.message).catch((err) => {
        console.error('[Callback] Auto-update cleanup error:', err);
      });
    }

    return NextResponse.json({
      success: true,
      job: updatedJob,
    });
  } catch (error) {
    console.error('[Callback] Unhandled callback error:', error);
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
