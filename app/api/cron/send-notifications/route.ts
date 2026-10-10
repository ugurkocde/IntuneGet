/**
 * Send Notifications Cron Job
 * Runs daily to send email and webhook notifications for detected updates
 */

import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isEmailConfigured } from '@/lib/email/service';
import { notifyUserOfPendingUpdates } from '@/lib/notifications/notify-user';
import type { UpdateCheckResult } from '@/types/notifications';

const BATCH_SIZE = 20;

// Rows requested per read. PostgREST returns at most its max-rows setting
// (1000 on hosted Supabase) per request, whatever the request asks for.
const PAGE_SIZE = 1000;

// Users per pending update read, keeping the user_id filter in the URL short.
const USER_CHUNK_SIZE = 50;

// Stop starting new user batches after this long so the run finishes inside
// maxDuration (300 s) with room for the batch already in flight. Users that
// are not reached keep their rows pending and are picked up by the next run.
const PROCESSING_BUDGET_MS = 240_000;

type PageResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * Read every row of a query, keyset paged on a unique column.
 *
 * Each page asks for rows after the last key already read and the loop ends
 * only on an empty page. A page shorter than PAGE_SIZE is not treated as the
 * end, so a lower max-rows setting cannot truncate the result, and rows that
 * change state during the read cannot shift later rows out of a page the way
 * offset paging would.
 */
async function readAllByKey<T>(
  fetchPage: (afterKey: string | null) => PageResult,
  keyOf: (row: T) => string
): Promise<T[]> {
  const rows: T[] = [];
  let afterKey: string | null = null;

  for (;;) {
    const { data, error } = await fetchPage(afterKey);
    if (error) {
      throw new Error(error.message);
    }
    const page = (data as T[] | null) || [];
    if (page.length === 0) {
      return rows;
    }
    rows.push(...page);
    afterKey = keyOf(page[page.length - 1]);
  }
}

/**
 * Users that have at least one channel the notification helper can deliver
 * to: email enabled (when email is configured for this deployment) or an
 * enabled webhook. Pending rows of other users can never be delivered, stay
 * pending, and are not read at all, so they cannot crowd out deliverable users.
 */
async function loadChannelUserIds(supabase: SupabaseClient): Promise<string[]> {
  const [emailUsers, webhookUsers] = await Promise.all([
    isEmailConfigured()
      ? readAllByKey<{ user_id: string }>((after) => {
          let query = supabase
            .from('notification_preferences')
            .select('user_id')
            .eq('email_enabled', true);
          if (after !== null) query = query.gt('user_id', after);
          return query.order('user_id', { ascending: true }).limit(PAGE_SIZE);
        }, (row) => row.user_id)
      : Promise.resolve([]),
    readAllByKey<{ id: string; user_id: string }>((after) => {
      let query = supabase
        .from('webhook_configurations')
        .select('id, user_id')
        .eq('is_enabled', true);
      if (after !== null) query = query.gt('id', after);
      return query.order('id', { ascending: true }).limit(PAGE_SIZE);
    }, (row) => row.id),
  ]);

  const userIds = new Set<string>();
  emailUsers.forEach((row) => userIds.add(row.user_id));
  webhookUsers.forEach((row) => userIds.add(row.user_id));
  return Array.from(userIds).sort();
}

/**
 * Load every pending update (not yet notified and not dismissed) of the given
 * users, a chunk of users at a time, keyset paged on the primary key.
 */
async function loadPendingUpdates(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<UpdateCheckResult[]> {
  const rows: UpdateCheckResult[] = [];
  for (let i = 0; i < userIds.length; i += USER_CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + USER_CHUNK_SIZE);
    const chunkRows = await readAllByKey<UpdateCheckResult>((after) => {
      let query = supabase
        .from('update_check_results')
        .select('*')
        .in('user_id', chunk)
        .is('notified_at', null)
        .is('dismissed_at', null);
      if (after !== null) query = query.gt('id', after);
      return query.order('id', { ascending: true }).limit(PAGE_SIZE);
    }, (row) => row.id);
    rows.push(...chunkRows);
  }
  return rows;
}

export async function GET(request: Request) {
  const startedAt = Date.now();

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
    const channelUserIds = await loadChannelUserIds(supabase);
    const pendingUpdates = await loadPendingUpdates(supabase, channelUserIds);

    if (pendingUpdates.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending updates to notify',
        emailsSent: 0,
        webhooksSent: 0,
      });
    }

    // Newest first within each user's notification, as the single read did. Ties
    // fall back to the id so the order is deterministic.
    const detectedAt = (update: UpdateCheckResult) => update.detected_at ?? '';
    pendingUpdates.sort(
      (a, b) => detectedAt(b).localeCompare(detectedAt(a)) || a.id.localeCompare(b.id)
    );

    // Group updates by user
    const userUpdates = new Map<string, UpdateCheckResult[]>();
    pendingUpdates.forEach((update) => {
      if (!userUpdates.has(update.user_id)) {
        userUpdates.set(update.user_id, []);
      }
      userUpdates.get(update.user_id)!.push(update);
    });

    let emailsSent = 0;
    let webhooksSent = 0;
    let updatesProcessed = 0;
    const errors: string[] = [];

    // Users whose oldest pending update has waited longest go first, so a run
    // that hits the time budget cannot starve the same users every day.
    const oldestPending = (userId: string) => {
      const updates = userUpdates.get(userId)!;
      return detectedAt(updates[updates.length - 1]);
    };
    const userIds = Array.from(userUpdates.keys()).sort(
      (a, b) => oldestPending(a).localeCompare(oldestPending(b)) || a.localeCompare(b)
    );

    // Process users in batches, delegating per-user delivery to the shared
    // helper that the on-demand refresh path also uses.
    let usersProcessed = 0;
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      if (Date.now() - startedAt > PROCESSING_BUDGET_MS) {
        break;
      }

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
      usersProcessed += batchUserIds.length;

      // Rate limiting between batches
      if (i + BATCH_SIZE < userIds.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const usersRemaining = userIds.length - usersProcessed;
    if (usersRemaining > 0) {
      console.warn(
        `[send-notifications] Time budget reached: processed ${usersProcessed} of ${userIds.length} users; ` +
          `${usersRemaining} users keep their updates pending for the next run`
      );
    }

    return NextResponse.json({
      success: errors.length === 0 && usersRemaining === 0,
      emailsSent,
      webhooksSent,
      updatesProcessed,
      channelUsers: channelUserIds.length,
      pendingUpdates: pendingUpdates.length,
      usersProcessed,
      usersRemaining,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Allow up to 5 minutes for the job to complete
export const maxDuration = 300;
