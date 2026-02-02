/**
 * Webhook Signature Utilities
 * HMAC-SHA256 signature generation and verification for webhook payloads
 */

import crypto from 'crypto';

/**
 * Generate an HMAC-SHA256 signature for a webhook payload
 */
export function generateWebhookSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verify a webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = generateWebhookSignature(payload, secret);

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

/**
 * Generate a secure random secret for webhooks
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create webhook headers with signature
 */
export function createWebhookHeaders(
  payload: string,
  secret: string | null,
  customHeaders: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'IntuneGet-Webhook/1.0',
    'X-IntuneGet-Timestamp': new Date().toISOString(),
    ...customHeaders,
  };

  if (secret) {
    headers['X-IntuneGet-Signature'] = generateWebhookSignature(payload, secret);
  }

  return headers;
}
