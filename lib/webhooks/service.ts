/**
 * Webhook Service
 * Handles webhook delivery with retry logic and circuit breaker pattern
 */

import { createHmac } from 'crypto';
import type {
  WebhookConfiguration,
  NotificationPayload,
  WebhookTestPayload,
  WebhookType,
} from '@/types/notifications';
import {
  formatSlackMessage,
  formatTeamsMessage,
  formatDiscordMessage,
  formatCustomPayload,
  formatSlackTestMessage,
  formatTeamsTestMessage,
  formatDiscordTestMessage,
} from './formatters';
import {
  describeWebhookFailure,
  parseWebhookUrl,
  postWebhook,
  WebhookDestinationError,
} from './destination';

// Circuit breaker thresholds
const MAX_FAILURES = 5;
const CIRCUIT_BREAKER_RESET_MINUTES = 30;

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  retryable?: boolean;
}

export interface WebhookDeliveryOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

const DEFAULT_OPTIONS: WebhookDeliveryOptions = {
  timeout: 10000, // 10 seconds
  retries: 3,
  retryDelay: 1000, // 1 second
};

/**
 * Check if webhook is in circuit breaker state
 */
export function isCircuitBreakerOpen(webhook: WebhookConfiguration): boolean {
  if (webhook.failure_count < MAX_FAILURES) {
    return false;
  }

  // Check if enough time has passed to retry
  if (webhook.last_failure_at) {
    const lastFailure = new Date(webhook.last_failure_at);
    const resetTime = new Date(lastFailure.getTime() + CIRCUIT_BREAKER_RESET_MINUTES * 60 * 1000);
    return new Date() < resetTime;
  }

  return true;
}

/**
 * Generate HMAC signature for webhook payload
 */
export function generateWebhookSignature(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Format payload based on webhook type
 */
export function formatPayload(
  webhookType: WebhookType,
  payload: NotificationPayload
): unknown {
  switch (webhookType) {
    case 'slack':
      return formatSlackMessage(payload);
    case 'teams':
      return formatTeamsMessage(payload);
    case 'discord':
      return formatDiscordMessage(payload);
    case 'custom':
    default:
      return formatCustomPayload(payload);
  }
}

/**
 * Format test payload based on webhook type
 */
export function formatTestPayload(
  webhookType: WebhookType,
  webhookName: string
): unknown {
  const testPayload: WebhookTestPayload = {
    event: 'test',
    timestamp: new Date().toISOString(),
    message: 'This is a test notification from IntuneGet to verify your webhook configuration.',
    webhook_name: webhookName,
  };

  switch (webhookType) {
    case 'slack':
      return formatSlackTestMessage(testPayload);
    case 'teams':
      return formatTeamsTestMessage(testPayload);
    case 'discord':
      return formatDiscordTestMessage(testPayload);
    case 'custom':
    default:
      return { ...testPayload, data: testPayload };
  }
}

/**
 * Deliver webhook with retry logic
 */
export async function deliverWebhook(
  webhook: WebhookConfiguration,
  payload: NotificationPayload,
  options: WebhookDeliveryOptions = {}
): Promise<WebhookDeliveryResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check circuit breaker
  if (isCircuitBreakerOpen(webhook)) {
    return {
      success: false,
      error: 'Circuit breaker is open due to repeated failures',
      retryable: false,
    };
  }

  // Format payload for webhook type
  const formattedPayload = formatPayload(webhook.webhook_type, payload);
  const payloadString = JSON.stringify(formattedPayload);

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'IntuneGet-Webhook/1.0',
    ...webhook.headers,
  };

  // Add signature if secret is configured
  if (webhook.secret) {
    headers['X-Webhook-Signature'] = generateWebhookSignature(payloadString, webhook.secret);
  }

  // Attempt delivery with retries
  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  for (let attempt = 0; attempt <= (opts.retries || 0); attempt++) {
    if (attempt > 0) {
      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, opts.retryDelay));
    }

    try {
      // The destination is resolved, checked and pinned on every attempt.
      const response = await postWebhook(webhook.url, {
        headers,
        body: payloadString,
        timeoutMs: opts.timeout ?? 10000,
      });

      lastStatusCode = response.status;

      if (response.status >= 200 && response.status < 300) {
        return {
          success: true,
          statusCode: response.status,
        };
      }

      // Non-retryable errors
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return {
          success: false,
          statusCode: response.status,
          error: `HTTP ${response.status}: ${response.bodyExcerpt.slice(0, 200)}`,
          retryable: false,
        };
      }

      // Retryable error (5xx or 429)
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      const failure = describeWebhookFailure(error);
      if (!failure.retryable) {
        // Refused destinations and redirects fail the same way every time.
        return {
          success: false,
          statusCode: failure.statusCode,
          error: failure.message,
          retryable: false,
        };
      }
      lastError = failure.message;
    }
  }

  return {
    success: false,
    statusCode: lastStatusCode,
    error: lastError || 'Delivery failed after retries',
    retryable: true,
  };
}

/**
 * Send test webhook
 */
export async function sendTestWebhook(
  webhook: WebhookConfiguration
): Promise<WebhookDeliveryResult> {
  const formattedPayload = formatTestPayload(webhook.webhook_type, webhook.name);
  const payloadString = JSON.stringify(formattedPayload);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'IntuneGet-Webhook/1.0',
    ...webhook.headers,
  };

  if (webhook.secret) {
    headers['X-Webhook-Signature'] = generateWebhookSignature(payloadString, webhook.secret);
  }

  try {
    const response = await postWebhook(webhook.url, {
      headers,
      body: payloadString,
      timeoutMs: 10000,
    });

    if (response.status >= 200 && response.status < 300) {
      return {
        success: true,
        statusCode: response.status,
      };
    }

    // The result goes back to the caller of the test endpoint, so it carries
    // the status code only and never text returned by the destination.
    return {
      success: false,
      statusCode: response.status,
      error: `HTTP ${response.status}`,
    };
  } catch (error) {
    const failure = describeWebhookFailure(error);
    return {
      success: false,
      statusCode: failure.statusCode,
      error: failure.message,
    };
  }
}

/**
 * Validate the webhook URL string (HTTPS, no embedded credentials).
 * This does not resolve the host. Routes that store a URL must also call
 * validateWebhookDestination from ./destination, which requires a public
 * destination.
 */
export function validateWebhookUrl(url: string): { valid: boolean; error?: string } {
  try {
    parseWebhookUrl(url);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof WebhookDestinationError ? error.message : 'Invalid URL format',
    };
  }
}

/**
 * Detect webhook type from URL
 */
export function detectWebhookType(url: string): WebhookType | null {
  if (url.includes('hooks.slack.com')) {
    return 'slack';
  }
  if (url.includes('webhook.office.com') || url.includes('logic.azure.com')) {
    return 'teams';
  }
  if (url.includes('discord.com/api/webhooks')) {
    return 'discord';
  }
  return null;
}
