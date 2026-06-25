/**
 * Send Notifications Cron Job
 * Runs daily to send email and webhook notifications for detected updates
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { notifyUserOfPendingUpdates } from '@/lib/notifications/notify-user';
import type { UpdateCheckResult } from '@/types/notifications';

const BATCH_SIZE = 20;

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get pending updates (not yet notified and not dismissed)
    const { data: pendingUpdates, error: updatesError } = await supabase
      .from('update_check_results')
      .select('*')
      .is('notified_at', null)
      .is('dismissed_at', null)
      .order('detected_at', { ascending: false });

    if (updatesError) {
      throw updatesError;
    }

    if (!pendingUpdates || pendingUpdates.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending updates to notify',
        emailsSent: 0,
        webhooksSent: 0,
      });
    }

    // Group updates by user
    const userUpdates = new Map<string, UpdateCheckResult[]>();
    (pendingUpdates as UpdateCheckResult[]).forEach((update) => {
      if (!userUpdates.has(update.user_id)) {
        userUpdates.set(update.user_id, []);
      }
      userUpdates.get(update.user_id)!.push(update);
    });

    let emailsSent = 0;
    let webhooksSent = 0;
    let updatesProcessed = 0;
    const errors: string[] = [];

    // Process users in batches, delegating per-user delivery to the shared
    // helper that the on-demand refresh path also uses.
    const userIds = Array.from(userUpdates.keys());

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batchUserIds = userIds.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batchUserIds.map(async (userId) => {
          const res = await notifyUserOfPendingUpdates(supabase, userId, {
            pendingUpdates: userUpdates.get(userId)!,
          });
          emailsSent += res.emailsSent;
          webhooksSent += res.webhooksSent;
          updatesProcessed += res.notifiedUpdateIds.length;
          errors.push(...res.errors);
        })
      );

      // Rate limiting between batches
      if (i + BATCH_SIZE < userIds.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      emailsSent,
      webhooksSent,
      updatesProcessed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Allow up to 5 minutes for the job to complete
export const maxDuration = 300;
