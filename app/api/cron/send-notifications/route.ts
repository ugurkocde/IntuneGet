/**
 * Send Notifications Cron Job
 * Runs daily to send email and webhook notifications for detected updates
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendUpdateNotificationEmail, isEmailConfigured } from '@/lib/email/service';
import { deliverWebhook } from '@/lib/webhooks/service';
import type {
  NotificationPreferences,
  WebhookConfiguration,
  UpdateCheckResult,
  NotificationPayload,
  AppUpdate,
} from '@/types/notifications';

const BATCH_SIZE = 20;

interface UserProfile {
  id: string;
  email: string | null;
  name: string | null;
  tenant_name: string | null;
}

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
    pendingUpdates.forEach((update: UpdateCheckResult) => {
      if (!userUpdates.has(update.user_id)) {
        userUpdates.set(update.user_id, []);
      }
      userUpdates.get(update.user_id)!.push(update);
    });

    let emailsSent = 0;
    let webhooksSent = 0;
    const errors: string[] = [];
    const notifiedUpdateIds: string[] = [];

    // Process users in batches
    const userIds = Array.from(userUpdates.keys());

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batchUserIds = userIds.slice(i, i + BATCH_SIZE);

      // Get notification preferences for these users
      const { data: preferences, error: prefsError } = await supabase
        .from('notification_preferences')
        .select('*')
        .in('user_id', batchUserIds);

      if (prefsError) {
        errors.push(`Error fetching preferences: ${prefsError.message}`);
        continue;
      }

      // Get webhooks for these users
      const { data: webhooks, error: webhooksError } = await supabase
        .from('webhook_configurations')
        .select('*')
        .in('user_id', batchUserIds)
        .eq('is_enabled', true);

      if (webhooksError) {
        errors.push(`Error fetching webhooks: ${webhooksError.message}`);
        continue;
      }

      // Get user profiles for email and name
      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('id, email, name, tenant_name')
        .in('id', batchUserIds);

      if (profilesError) {
        errors.push(`Error fetching profiles: ${profilesError.message}`);
      }

      const profileMap = new Map<string, UserProfile>();
      profiles?.forEach((p: UserProfile) => profileMap.set(p.id, p));

      const prefsMap = new Map<string, NotificationPreferences>();
      preferences?.forEach((p: NotificationPreferences) =>
        prefsMap.set(p.user_id, p)
      );

      const webhookMap = new Map<string, WebhookConfiguration[]>();
      webhooks?.forEach((w: WebhookConfiguration) => {
        if (!webhookMap.has(w.user_id)) {
          webhookMap.set(w.user_id, []);
        }
        webhookMap.get(w.user_id)!.push(w);
      });

      // Process each user
      for (const userId of batchUserIds) {
        const updates = userUpdates.get(userId)!;
        const prefs = prefsMap.get(userId);
        const userWebhooks = webhookMap.get(userId) || [];
        const profile = profileMap.get(userId);

        // Filter updates based on preferences
        let filteredUpdates = updates;
        if (prefs?.notify_critical_only) {
          filteredUpdates = updates.filter((u) => u.is_critical);
        }

        if (filteredUpdates.length === 0) {
          // Mark all as notified even if filtered out
          notifiedUpdateIds.push(...updates.map((u) => u.id));
          continue;
        }

        // Group by tenant for payload
        const tenantUpdates = new Map<string, UpdateCheckResult[]>();
        filteredUpdates.forEach((u) => {
          if (!tenantUpdates.has(u.tenant_id)) {
            tenantUpdates.set(u.tenant_id, []);
          }
          tenantUpdates.get(u.tenant_id)!.push(u);
        });

        // Send notifications for each tenant
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
            summary: {
              total: appUpdates.length,
              critical: criticalCount,
            },
          };

          // Send email if enabled and configured
          if (prefs?.email_enabled && isEmailConfigured()) {
            // Check frequency
            const shouldSendEmail = shouldSendBasedOnFrequency(
              prefs.email_frequency
            );

            if (shouldSendEmail) {
              const emailAddress = prefs.email_address || profile?.email;
              if (emailAddress) {
                const result = await sendUpdateNotificationEmail(
                  emailAddress,
                  payload,
                  profile?.name || undefined
                );

                // Record notification history
                await supabase.from('notification_history').insert({
                  user_id: userId,
                  channel: 'email',
                  payload,
                  status: result.success ? 'sent' : 'failed',
                  error_message: result.error || null,
                  apps_notified: appUpdates.length,
                  sent_at: result.success ? new Date().toISOString() : null,
                });

                if (result.success) {
                  emailsSent++;
                } else {
                  errors.push(
                    `Email to ${emailAddress} failed: ${result.error}`
                  );
                }
              }
            }
          }

          // Send webhooks
          for (const webhook of userWebhooks) {
            const result = await deliverWebhook(webhook, payload);

            // Update webhook status
            const statusUpdate: Record<string, unknown> = {
              updated_at: new Date().toISOString(),
            };

            if (result.success) {
              statusUpdate.last_success_at = new Date().toISOString();
              statusUpdate.failure_count = 0;
            } else {
              statusUpdate.last_failure_at = new Date().toISOString();
              statusUpdate.failure_count = (webhook.failure_count || 0) + 1;
            }

            await supabase
              .from('webhook_configurations')
              .update(statusUpdate)
              .eq('id', webhook.id);

            // Record notification history
            await supabase.from('notification_history').insert({
              user_id: userId,
              channel: 'webhook',
              webhook_id: webhook.id,
              payload,
              status: result.success ? 'sent' : 'failed',
              error_message: result.error || null,
              apps_notified: appUpdates.length,
              sent_at: result.success ? new Date().toISOString() : null,
            });

            if (result.success) {
              webhooksSent++;
            } else {
              errors.push(`Webhook ${webhook.name} failed: ${result.error}`);
            }
          }

          // Mark updates as notified
          notifiedUpdateIds.push(...tenantUpdateList.map((u) => u.id));
        }
      }

      // Rate limiting between batches
      if (i + BATCH_SIZE < userIds.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Update notified_at for all processed updates
    if (notifiedUpdateIds.length > 0) {
      // Process in chunks to avoid query size limits
      const chunkSize = 100;
      for (let i = 0; i < notifiedUpdateIds.length; i += chunkSize) {
        const chunk = notifiedUpdateIds.slice(i, i + chunkSize);
        await supabase
          .from('update_check_results')
          .update({ notified_at: new Date().toISOString() })
          .in('id', chunk);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      emailsSent,
      webhooksSent,
      updatesProcessed: notifiedUpdateIds.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * Determine if notification should be sent based on frequency
 * For daily: always send (cron runs daily)
 * For weekly: only send on Sundays
 * For immediate: should be handled separately (not by cron)
 */
function shouldSendBasedOnFrequency(frequency: string): boolean {
  if (frequency === 'immediate') {
    // Immediate notifications should be sent when updates are detected
    // For daily cron, we treat immediate as "send now"
    return true;
  }

  if (frequency === 'weekly') {
    // Only send on Sundays
    return new Date().getDay() === 0;
  }

  // Daily - always send
  return true;
}

// Allow up to 5 minutes for the job to complete
export const maxDuration = 300;
