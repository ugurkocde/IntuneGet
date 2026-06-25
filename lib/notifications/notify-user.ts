/**
 * Per-user update notification dispatch.
 *
 * Shared by the daily send-notifications cron and the on-demand
 * /api/updates/refresh route so update notifications go out the same way
 * whether they are batched nightly or triggered right after a user-facing
 * refresh detects a new update. Keeping this in one place avoids the two
 * paths drifting apart.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendUpdateNotificationEmail, isEmailConfigured } from '@/lib/email/service';
import { deliverWebhook } from '@/lib/webhooks/service';
import type {
  NotificationPreferences,
  WebhookConfiguration,
  UpdateCheckResult,
  NotificationPayload,
  AppUpdate,
} from '@/types/notifications';

interface UserProfile {
  id: string;
  email: string | null;
  name: string | null;
  tenant_name: string | null;
}

export interface NotifyUserResult {
  emailsSent: number;
  webhooksSent: number;
  notifiedUpdateIds: string[];
  errors: string[];
}

/**
 * Determine if an email notification should be sent based on frequency.
 * daily/immediate: always send (the cron runs daily; immediate means "now").
 * weekly: only on Sundays.
 */
export function shouldSendBasedOnFrequency(frequency: string): boolean {
  if (frequency === 'weekly') {
    return new Date().getDay() === 0;
  }
  // daily and immediate both send on this run
  return true;
}

/**
 * Send email + webhook notifications for a single user's pending updates and
 * mark the delivered ones notified.
 *
 * @param pendingUpdates Optional preloaded pending rows for the user. When
 *   omitted, the function loads update_check_results rows with notified_at and
 *   dismissed_at null itself. Pass `respectFrequency: false` to force-send
 *   regardless of the user's email frequency (used by on-demand refresh, where
 *   the user just asked for a check).
 */
export async function notifyUserOfPendingUpdates(
  supabase: SupabaseClient,
  userId: string,
  options: {
    pendingUpdates?: UpdateCheckResult[];
    respectFrequency?: boolean;
  } = {}
): Promise<NotifyUserResult> {
  const respectFrequency = options.respectFrequency ?? true;

  const result: NotifyUserResult = {
    emailsSent: 0,
    webhooksSent: 0,
    notifiedUpdateIds: [],
    errors: [],
  };

  // Load pending updates for the user if not supplied
  let updates = options.pendingUpdates;
  if (!updates) {
    const { data, error } = await supabase
      .from('update_check_results')
      .select('*')
      .eq('user_id', userId)
      .is('notified_at', null)
      .is('dismissed_at', null)
      .order('detected_at', { ascending: false });
    if (error) {
      result.errors.push(`Error fetching pending updates: ${error.message}`);
      return result;
    }
    updates = (data as UpdateCheckResult[]) || [];
  }

  if (updates.length === 0) {
    return result;
  }

  const [{ data: prefsRow }, { data: webhookRows }, { data: profileRow }] =
    await Promise.all([
      supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('webhook_configurations').select('*').eq('user_id', userId).eq('is_enabled', true),
      supabase.from('user_profiles').select('id, email, name, tenant_name').eq('id', userId).maybeSingle(),
    ]);

  const prefs = (prefsRow as NotificationPreferences | null) || undefined;
  const userWebhooks = (webhookRows as WebhookConfiguration[] | null) || [];
  const profile = (profileRow as UserProfile | null) || undefined;

  // Filter updates based on preferences
  let filteredUpdates = updates;
  if (prefs?.notify_critical_only) {
    filteredUpdates = updates.filter((u) => u.is_critical);
  }

  if (filteredUpdates.length === 0) {
    // Nothing matches the user's filter; mark all as notified so they are not
    // reconsidered every run.
    result.notifiedUpdateIds.push(...updates.map((u) => u.id));
    await markNotified(supabase, result.notifiedUpdateIds);
    return result;
  }

  // Group by tenant for payload
  const tenantUpdates = new Map<string, UpdateCheckResult[]>();
  filteredUpdates.forEach((u) => {
    if (!tenantUpdates.has(u.tenant_id)) {
      tenantUpdates.set(u.tenant_id, []);
    }
    tenantUpdates.get(u.tenant_id)!.push(u);
  });

  for (const [tenantId, tenantUpdateList] of tenantUpdates) {
    const appUpdates: AppUpdate[] = tenantUpdateList.map((u) => ({
      app_name: u.display_name,
      winget_id: u.winget_id,
      intune_app_id: u.intune_app_id,
      current_version: u.current_version,
      latest_version: u.latest_version,
      is_critical: u.is_critical,
    }));

    const criticalCount = appUpdates.filter((u) => u.is_critical).length;

    const payload: NotificationPayload = {
      event: 'app_updates_available',
      timestamp: new Date().toISOString(),
      tenant_id: tenantId,
      tenant_name: profile?.tenant_name || undefined,
      updates: appUpdates,
      summary: { total: appUpdates.length, critical: criticalCount },
    };

    let delivered = false;

    // Send email if enabled and configured
    if (prefs?.email_enabled && isEmailConfigured()) {
      const shouldSendEmail = !respectFrequency || shouldSendBasedOnFrequency(prefs.email_frequency);
      if (shouldSendEmail) {
        const emailAddress = prefs.email_address || profile?.email;
        if (emailAddress) {
          const emailResult = await sendUpdateNotificationEmail(
            emailAddress,
            payload,
            profile?.name || undefined
          );

          await supabase.from('notification_history').insert({
            user_id: userId,
            channel: 'email',
            payload,
            status: emailResult.success ? 'sent' : 'failed',
            error_message: emailResult.error || null,
            apps_notified: appUpdates.length,
            sent_at: emailResult.success ? new Date().toISOString() : null,
          });

          if (emailResult.success) {
            delivered = true;
            result.emailsSent++;
          } else {
            result.errors.push(`Email to ${emailAddress} failed: ${emailResult.error}`);
          }
        } else {
          result.errors.push(
            `No email address available for user ${userId} (email_enabled is true but no address found)`
          );
        }
      }
    }

    // Send webhooks
    for (const webhook of userWebhooks) {
      const webhookResult = await deliverWebhook(webhook, payload);

      const statusUpdate: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (webhookResult.success) {
        statusUpdate.last_success_at = new Date().toISOString();
        statusUpdate.failure_count = 0;
      } else {
        statusUpdate.last_failure_at = new Date().toISOString();
        statusUpdate.failure_count = (webhook.failure_count || 0) + 1;
      }

      await supabase.from('webhook_configurations').update(statusUpdate).eq('id', webhook.id);

      await supabase.from('notification_history').insert({
        user_id: userId,
        channel: 'webhook',
        webhook_id: webhook.id,
        payload,
        status: webhookResult.success ? 'sent' : 'failed',
        error_message: webhookResult.error || null,
        apps_notified: appUpdates.length,
        sent_at: webhookResult.success ? new Date().toISOString() : null,
      });

      if (webhookResult.success) {
        delivered = true;
        result.webhooksSent++;
      } else {
        result.errors.push(`Webhook ${webhook.name} failed: ${webhookResult.error}`);
      }
    }

    // Only mark updates notified when at least one channel delivered, so
    // undelivered updates are retried on the next run until a valid channel
    // exists.
    if (delivered) {
      result.notifiedUpdateIds.push(...tenantUpdateList.map((u) => u.id));
    }
  }

  await markNotified(supabase, result.notifiedUpdateIds);
  return result;
}

async function markNotified(supabase: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    await supabase
      .from('update_check_results')
      .update({ notified_at: new Date().toISOString() })
      .in('id', chunk);
  }
}
