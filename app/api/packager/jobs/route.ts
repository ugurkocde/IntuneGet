/**
 * Packager Jobs API
 * Provides endpoints for the local packager to claim and update jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, verifyPackagerApiKey } from '@/lib/db';
import { getFeatureFlags } from '@/lib/features';

// Verify the packager auth key (API key for SQLite, service role key for Supabase)
function verifyPackagerAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const providedKey = authHeader.slice(7);
  return verifyPackagerApiKey(providedKey);
}

/**
 * GET /api/packager/jobs
 * Get queued jobs for the packager to claim
 */
export async function GET(request: NextRequest) {
  const features = getFeatureFlags();

  if (!features.localPackager) {
    return NextResponse.json(
      { error: 'Local packager mode is not enabled' },
      { status: 400 }
    );
  }

  if (!verifyPackagerAuth(request)) {
    return NextResponse.json(
      { error: 'Unauthorized - invalid packager credentials' },
      { status: 401 }
    );
  }

  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);
    const status = searchParams.get('status') || 'queued';

    const jobs = await db.jobs.getByStatus(status, limit, true);

    return NextResponse.json({ jobs: jobs || [] });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/packager/jobs
 * Claim a job for processing (atomic operation)
 */
export async function POST(request: NextRequest) {
  const features = getFeatureFlags();

  if (!features.localPackager) {
    return NextResponse.json(
      { error: 'Local packager mode is not enabled' },
      { status: 400 }
    );
  }

  if (!verifyPackagerAuth(request)) {
    return NextResponse.json(
      { error: 'Unauthorized - invalid packager credentials' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { jobId, packagerId } = body;

    if (!jobId || !packagerId) {
      return NextResponse.json(
        { error: 'jobId and packagerId are required' },
        { status: 400 }
      );
    }

    const db = getDatabase();

    // Atomically claim the job (only if still queued)
    const job = await db.jobs.claim(jobId, packagerId);

    if (!job) {
      // Job was already claimed or doesn't exist
      return NextResponse.json(
        { error: 'Job not available for claiming', claimed: false },
        { status: 409 }
      );
    }

    return NextResponse.json({
      claimed: true,
      job,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/packager/jobs
 * Update job status and progress (heartbeat and status updates)
 */
export async function PATCH(request: NextRequest) {
  const features = getFeatureFlags();

  if (!features.localPackager) {
    return NextResponse.json(
      { error: 'Local packager mode is not enabled' },
      { status: 400 }
    );
  }

  if (!verifyPackagerAuth(request)) {
    return NextResponse.json(
      { error: 'Unauthorized - invalid packager credentials' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { jobId, packagerId, status, progressPercent, progressMessage, error: errorMessage, intuneAppId, intuneAppUrl } = body;

    if (!jobId || !packagerId) {
      return NextResponse.json(
        { error: 'jobId and packagerId are required' },
        { status: 400 }
      );
    }

    const db = getDatabase();
    const now = new Date().toISOString();

    // Build update object
    const updateData: Record<string, unknown> = {
      packager_heartbeat_at: now,
    };

    if (status) {
      updateData.status = status;
    }

    if (progressPercent !== undefined) {
      updateData.progress_percent = progressPercent;
    }

    if (progressMessage) {
      updateData.progress_message = progressMessage;
    }

    // Handle status transitions
    if (status === 'uploading') {
      updateData.upload_started_at = now;
      updateData.packaging_completed_at = now;
    } else if (status === 'deployed') {
      updateData.completed_at = now;
      if (intuneAppId) updateData.intune_app_id = intuneAppId;
      if (intuneAppUrl) updateData.intune_app_url = intuneAppUrl;
    } else if (status === 'failed') {
      updateData.completed_at = now;
      if (errorMessage) updateData.error_message = errorMessage;
    }

    // Update the job (only if owned by this packager)
    const job = await db.jobs.update(jobId, updateData, { packager_id: packagerId });

    if (!job) {
      return NextResponse.json(
        { error: 'Failed to update job or job not owned by this packager' },
        { status: 400 }
      );
    }

    return NextResponse.json({ updated: true, job });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/packager/jobs
 * Release a claimed job (allows re-claiming by another packager)
 */
export async function DELETE(request: NextRequest) {
  const features = getFeatureFlags();

  if (!features.localPackager) {
    return NextResponse.json(
      { error: 'Local packager mode is not enabled' },
      { status: 400 }
    );
  }

  if (!verifyPackagerAuth(request)) {
    return NextResponse.json(
      { error: 'Unauthorized - invalid packager credentials' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    const packagerId = searchParams.get('packagerId');

    if (!jobId || !packagerId) {
      return NextResponse.json(
        { error: 'jobId and packagerId query parameters are required' },
        { status: 400 }
      );
    }

    const db = getDatabase();

    // Release the job back to queued state
    const job = await db.jobs.release(jobId, packagerId);

    if (!job) {
      return NextResponse.json(
        { error: 'Failed to release job or job not owned by this packager' },
        { status: 400 }
      );
    }

    return NextResponse.json({ released: true, job });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
