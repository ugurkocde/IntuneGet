/**
 * Webhook Service
 * Manages webhook delivery with retries and logging
 */

import { createServerClient } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { createWebhookHeaders } from './webhook-signatures';
import { describeWebhookFailure, postWebhook } from '@/lib/webhooks/destination';

// Webhook event types
export type WebhookEventType =
  | 'deployment.completed'
  | 'deployment.failed'
  | 'batch.completed'
  | 'member.joined'
  | 'member.removed'
  | 'consent.granted'
  | 'consent.expired'
  | 'consent.revoked';

export interface WebhookPayload {
  event_type: WebhookEventType;
  timestamp: string;
  organization_id: string;
  data: Record<string, unknown>;
}

interface WebhookConfiguration {
  id: string;
  organization_id: string;
  name: string;
  url: string;
  secret: string | null;
  event_types: string[];
  headers: Record<string, string>;
  is_enabled: boolean;
  failure_count: number;
}

/**
 * Queue a webhook delivery for the specified event
 */
export async function queueWebhookDelivery(
  organizationId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = createServerClient();

    // Get all enabled webhooks for this organization that subscribe to this event
    const { data: webhooks, error: webhooksError } = await supabase
      .from('msp_webhook_configurations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_enabled', true)
      .contains('event_types', [eventType]);

    if (webhooksError || !webhooks || webhooks.length === 0) {
      return; // No webhooks to deliver
    }

    const payload: WebhookPayload = {
      event_type: eventType,
      timestamp: new Date().toISOString(),
      organization_id: organizationId,
      data,
    };

    const deliveries = (webhooks as WebhookConfiguration[]).map((webhook) => ({
      webhook_id: webhook.id,
      event_type: eventType,
      payload: { ...payload },
      status: 'pending' as const,
      next_retry_at: new Date().toISOString(),
    }));
    const { data: inserted, error } = await supabase
      .from('msp_webhook_deliveries').insert(deliveries).select('*');
    if (error || !inserted?.length) {
      console.error('Could not persist webhook deliveries');
      return;
    }
    await Promise.allSettled((inserted as WebhookDelivery[]).map(async delivery => {
      const config = (webhooks as WebhookConfiguration[]).find(w => w.id === delivery.webhook_id);
      if (config) await deliverWebhook(supabase, config, delivery);
    }));
  } catch {
    console.error('Error queuing webhook delivery');
  }
}

interface WebhookDelivery {
  id: string;
  webhook_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

const DELIVERY_LEASE_MS = 2 * 60_000;

/** One claim path protects both immediate sends and overlapping cron workers. */
async function deliverWebhook(
  supabase: ReturnType<typeof createServerClient>,
  webhook: WebhookConfiguration,
  delivery: WebhookDelivery,
): Promise<boolean> {
  const now = new Date().toISOString();
  const terminal = !webhook.is_enabled || webhook.organization_id !== delivery.payload.organization_id;
  const exhausted = delivery.attempts >= delivery.max_attempts;
  if (terminal || exhausted) {
    const { error } = await supabase.from('msp_webhook_deliveries').update({
      status: 'failed', next_retry_at: null,
      error_message: terminal ? 'Webhook is disabled or no longer matches the event organization' : 'Delivery attempt limit reached',
    }).eq('id', delivery.id).eq('status', 'pending').eq('attempts', delivery.attempts).lte('next_retry_at', now);
    if (error) console.error('Could not finalize unavailable webhook delivery');
    return false;
  }
  const attempts = delivery.attempts + 1;
  const { data: claimed, error: claimError } = await supabase.from('msp_webhook_deliveries')
    .update({ attempts, next_retry_at: new Date(Date.now() + DELIVERY_LEASE_MS).toISOString() })
    .eq('id', delivery.id).eq('status', 'pending').eq('attempts', delivery.attempts)
    .lte('next_retry_at', now).select('id');
  if (claimError || claimed?.length !== 1) return false;

  // Send and sign the persisted jsonb payload on the first attempt as well as retries.
  const payloadString = JSON.stringify(delivery.payload);
  let values: Database['public']['Tables']['msp_webhook_deliveries']['Update'];
  let succeeded = false;
  try {
    const response = await postWebhook(webhook.url, {
      headers: createWebhookHeaders(payloadString, webhook.secret, webhook.headers),
      body: payloadString, timeoutMs: 10000,
    });
    succeeded = response.status >= 200 && response.status < 300;
    values = succeeded ? {
      status: 'success', response_status: response.status, response_body: response.bodyExcerpt.substring(0, 1000),
      error_message: null, delivered_at: new Date().toISOString(), next_retry_at: null,
    } : failureValues(attempts, delivery.max_attempts, `HTTP ${response.status}: ${response.bodyExcerpt.substring(0, 200)}`, response.status);
  } catch (error) {
    const failure = describeWebhookFailure(error);
    values = failureValues(attempts, delivery.max_attempts, failure.message, failure.statusCode);
  }
  const { data: finalized, error: finalError } = await supabase.from('msp_webhook_deliveries')
    .update(values).eq('id', delivery.id).eq('status', 'pending').eq('attempts', attempts).select('id');
  if (finalError || finalized?.length !== 1) {
    console.error('Webhook delivery result was not persisted by its claim');
    return true;
  }
  if (succeeded || attempts >= delivery.max_attempts) {
    const { error } = await supabase.from('msp_webhook_configurations').update(succeeded ? {
      failure_count: 0, last_success_at: new Date().toISOString(),
    } : { failure_count: webhook.failure_count + 1, last_failure_at: new Date().toISOString() }).eq('id', webhook.id);
    if (error) console.error('Could not update webhook delivery summary');
  }
  return true;
}

function failureValues(attempts: number, max: number, message: string, status?: number): Database['public']['Tables']['msp_webhook_deliveries']['Update'] {
  return {
    status: attempts >= max ? 'failed' : 'pending',
    response_status: status ?? null, error_message: message,
    next_retry_at: attempts >= max ? null : new Date(Date.now() + Math.pow(2, attempts) * 60_000).toISOString(),
  };
}

/** Retry a bounded page using the existing process-batches schedule. */
export async function processDueWebhookDeliveries(): Promise<number> {
  const supabase = createServerClient();
  const { data, error } = await supabase.from('msp_webhook_deliveries').select('*')
    .eq('status', 'pending').lte('next_retry_at', new Date().toISOString())
    .order('next_retry_at', { ascending: true }).limit(10);
  if (error) throw new Error('Could not read due webhook deliveries');
  let sent = 0;
  for (const delivery of (data ?? []) as WebhookDelivery[]) {
    const { data: config, error: configError } = await supabase.from('msp_webhook_configurations')
      .select('*').eq('id', delivery.webhook_id).maybeSingle();
    if (configError) throw new Error('Could not read webhook configuration');
    // A deleted configuration cascades to its deliveries.
    if (config && await deliverWebhook(supabase, config as WebhookConfiguration, delivery)) sent++;
  }
  return sent;
}

/**
 * Send a test webhook delivery
 */
export async function sendTestWebhook(
  webhook: WebhookConfiguration
): Promise<{ success: boolean; message: string; response_status?: number }> {
  const testPayload: WebhookPayload = {
    event_type: 'deployment.completed',
    timestamp: new Date().toISOString(),
    organization_id: webhook.organization_id,
    data: {
      test: true,
      message: 'This is a test webhook from IntuneGet',
    },
  };

  const payloadString = JSON.stringify(testPayload);
  const headers = createWebhookHeaders(payloadString, webhook.secret, webhook.headers);

  try {
    const response = await postWebhook(webhook.url, {
      headers,
      body: payloadString,
      timeoutMs: 10000,
    });

    if (response.status >= 200 && response.status < 300) {
      return {
        success: true,
        message: 'Test webhook delivered successfully',
        response_status: response.status,
      };
    } else {
      // The result goes back to the caller of the test endpoint, so it
      // carries the status code only and never text from the destination.
      return {
        success: false,
        message: `HTTP ${response.status}`,
        response_status: response.status,
      };
    }
  } catch (error) {
    const failure = describeWebhookFailure(error);

    return {
      success: false,
      message: failure.message,
      ...(failure.statusCode !== undefined && { response_status: failure.statusCode }),
    };
  }
}
