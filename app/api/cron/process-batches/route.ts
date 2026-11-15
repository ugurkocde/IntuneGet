/**
 * Process Batches Cron Job
 * Runs every 2 minutes via Vercel Cron to process pending batch deployments
 * and recover stale items.
 */

import { NextResponse } from 'next/server';
import { processDueWebhookDeliveries } from '@/lib/msp/webhook-service';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import {
  processPendingBatches,
  advanceInProgressBatches,
} from '@/lib/msp/batch-orchestrator';

export async function GET(request: Request) {
  // Verify cron secret
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Missing Supabase configuration' },
      { status: 500 }
    );
  }

  try {
    // Process pending batches (new batches waiting to start)
    const batchResult = await processPendingBatches();

    // Advance in-progress batches (recover stale items, check completion)
    const recoveryResult = await advanceInProgressBatches();

    let webhooks = 0;
    try {
      webhooks = await processDueWebhookDeliveries();
    } catch {
      console.error('MSP webhook retry processing failed');
    }

    const allErrors = [...batchResult.errors, ...recoveryResult.errors];

    return NextResponse.json({
      success: allErrors.length === 0,
      webhooks,
      processed: batchResult.batchesProcessed,
      started: batchResult.itemsStarted,
      recovered: recoveryResult.staleItemsRecovered,
      completed: recoveryResult.batchesCompleted,
      errors: allErrors.length > 0 ? allErrors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Allow up to 5 minutes for the job to complete
export const maxDuration = 300;
