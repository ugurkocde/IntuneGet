/**
 * Callback Signature Verification
 * HMAC-SHA256 signature verification for GitHub Actions callbacks
 */

import crypto from 'crypto';

/**
 * Verify the HMAC-SHA256 signature of a callback request
 *
 * @param body - The raw request body as a string
 * @param signature - The signature from the X-Signature header
 * @param secret - The shared secret for HMAC verification
 * @returns true if the signature is valid, false otherwise
 */
export function verifyCallbackSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }

  if (!secret) {
    console.error('Callback secret is not configured');
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('base64');

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (error) {
    console.error('Error verifying callback signature:', error);
    return false;
  }
}

/**
 * Generate an HMAC-SHA256 signature for a payload
 * (Useful for testing purposes)
 *
 * @param body - The request body as a string
 * @param secret - The shared secret for HMAC
 * @returns The base64-encoded signature
 */
export function generateSignature(body: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');
}
