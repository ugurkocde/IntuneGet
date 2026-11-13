/**
 * Webhook Service
 * Manages webhook delivery with retries and logging
 */

import { createServerClient } from '@/lib/supabase';
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

    const payloadString = JSON.stringify(payload);

    // Create delivery records for each webhook
    // Convert payload to Record<string, unknown> for database storage
    const payloadForDb: Record<string, unknown> = {
      event_type: payload.event_type,
      timestamp: payload.timestamp,
      organization_id: payload.organization_id,
      data: payload.data,
    };
    const deliveries = (webhooks as WebhookConfiguration[]).map((webhook) => ({
      webhook_id: webhook.id,
      event_type: eventType,
      payload: payloadForDb,
      status: 'pending' as const,
      next_retry_at: new Date().toISOString(),
    }));

    await supabase
      .from('msp_webhook_deliveries')
      .insert(deliveries);

    // Attempt immediate delivery for each webhook
    for (const webhook of webhooks as WebhookConfiguration[]) {
      // Fire and forget - don't wait for delivery
      deliverWebhook(webhook, payloadString).catch((err) => {
        console.error(`Failed to deliver webhook ${webhook.id}:`, err);
      });
    }
  } catch (error) {
    console.error('Error queuing webhook delivery:', error);
  }
}

/**
 * Deliver a webhook to its destination
 */
async function deliverWebhook(
  webhook: WebhookConfiguration,
  payloadString: string
): Promise<void> {
  const supabase = createServerClient();

  // Get the pending delivery for this webhook
  const { data: delivery, error: deliveryError } = await supabase
    .from('msp_webhook_deliveries')
    .select('*')
    .eq('webhook_id', webhook.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (deliveryError || !delivery) {
    return;
  }

  try {
    const headers = createWebhookHeaders(
      payloadString,
      webhook.secret,
      webhook.headers
    );

    // The destination is resolved, checked and pinned before every delivery.
    const response = await postWebhook(webhook.url, {
      headers,
      body: payloadString,
      timeoutMs: 10000, // 10 second timeout
    });

    const responseBody = response.bodyExcerpt;

    if (response.status >= 200 && response.status < 300) {
      // Success - update delivery record
      await supabase
        .from('msp_webhook_deliveries')
        .update({
          status: 'success',
          attempts: delivery.attempts + 1,
          response_status: response.status,
          response_body: responseBody.substring(0, 1000),
          delivered_at: new Date().toISOString(),
        })
        .eq('id', delivery.id);

      // Update webhook success timestamp
      await supabase
        .from('msp_webhook_configurations')
        .update({
          failure_count: 0,
          last_success_at: new Date().toISOString(),
        })
        .eq('id', webhook.id);
    } else {
      // Failed - handle retry
      await handleDeliveryFailure(
        supabase,
        delivery,
        webhook,
        `HTTP ${response.status}: ${responseBody.substring(0, 200)}`,
        response.status
      );
    }
  } catch (error) {
    const failure = describeWebhookFailure(error);

    await handleDeliveryFailure(supabase, delivery, webhook, failure.message, failure.statusCode);
  }
}

/**
 * Webhook delivery record type
 */
interface WebhookDelivery {
  id: string;
  attempts: number;
  max_attempts?: number;
}

/**
 * Handle a failed webhook delivery
 */
async function handleDeliveryFailure(
  supabase: ReturnType<typeof createServerClient>,
  delivery: WebhookDelivery,
  webhook: WebhookConfiguration,
  errorMessage: string,
  responseStatus?: number
): Promise<void> {
  const attempts = delivery.attempts + 1;
  const maxAttempts = delivery.max_attempts || 3;

  if (attempts >= maxAttempts) {
    // Max attempts reached - mark as failed
    await supabase
      .from('msp_webhook_deliveries')
      .update({
        status: 'failed',
        attempts,
        response_status: responseStatus,
        error_message: errorMessage,
      })
      .eq('id', delivery.id);

    // Increment webhook failure count
    await supabase
      .from('msp_webhook_configurations')
      .update({
        failure_count: webhook.failure_count + 1,
        last_failure_at: new Date().toISOString(),
      })
      .eq('id', webhook.id);
  } else {
    // Schedule retry with exponential backoff
    const backoffMinutes = Math.pow(2, attempts); // 2, 4, 8 minutes
    const nextRetry = new Date();
    nextRetry.setMinutes(nextRetry.getMinutes() + backoffMinutes);

    await supabase
      .from('msp_webhook_deliveries')
      .update({
        attempts,
        response_status: responseStatus,
        error_message: errorMessage,
        next_retry_at: nextRetry.toISOString(),
      })
      .eq('id', delivery.id);
  }
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
