/**
 * Authentication Utilities
 * Shared utilities for parsing and validating authentication tokens
 */

import crypto from 'crypto';

/**
 * User information extracted from a Microsoft access token
 */
export interface TokenUserInfo {
  userId: string;
  userEmail: string;
  tenantId: string;
  userName: string | null;
}

/**
 * Parse user information from a Microsoft access token
 * Note: This only decodes the token payload, it does not verify the signature.
 * The token is already validated by Microsoft before being issued.
 * For additional security, implement proper JWKS validation in production.
 */
export function parseAccessToken(authHeader: string | null): TokenUserInfo | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  try {
    const accessToken = authHeader.slice(7);
    const parts = accessToken.split('.');

    if (parts.length !== 3) {
      return null;
    }

    const tokenPayload = JSON.parse(
      Buffer.from(parts[1], 'base64').toString()
    );

    const userId = tokenPayload.oid || tokenPayload.sub;
    const userEmail = tokenPayload.preferred_username || tokenPayload.email || 'unknown';
    const tenantId = tokenPayload.tid;
    const userName = tokenPayload.name || null;

    if (!userId || !tenantId) {
      return null;
    }

    return { userId, userEmail, tenantId, userName };
  } catch {
    return null;
  }
}

/**
 * Get the secret key for signing state parameters
 * Falls back to a derived key from client secret if STATE_SECRET is not set
 */
function getStateSecret(): string {
  const stateSecret = process.env.MSP_STATE_SECRET;
  if (stateSecret) {
    return stateSecret;
  }

  // Fall back to deriving from client secret
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;
  if (clientSecret) {
    return crypto.createHash('sha256').update(clientSecret + '_msp_state').digest('hex');
  }

  // In development, use a fixed secret (not secure for production)
  if (process.env.NODE_ENV === 'development') {
    return 'dev-state-secret-not-for-production';
  }

  throw new Error('MSP_STATE_SECRET or AZURE_AD_CLIENT_SECRET must be set');
}

/**
 * Sign a state parameter for consent URL
 * Format: mspOrgId:tenantRecordId:timestamp:signature
 */
export function signConsentState(mspOrgId: string, tenantRecordId: string): string {
  const timestamp = Date.now().toString();
  const payload = `${mspOrgId}:${tenantRecordId}:${timestamp}`;

  const secret = getStateSecret();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
    .substring(0, 16); // Use first 16 chars to keep URL shorter

  return `${payload}:${signature}`;
}

/**
 * Verify and parse a signed consent state parameter
 * Returns null if invalid or expired (1 hour expiry)
 */
export function verifyConsentState(state: string): { mspOrgId: string; tenantRecordId: string } | null {
  try {
    const parts = state.split(':');
    if (parts.length !== 4) {
      return null;
    }

    const [mspOrgId, tenantRecordId, timestamp, signature] = parts;

    // Verify timestamp (state expires after 1 hour)
    const stateTime = parseInt(timestamp, 10);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    if (isNaN(stateTime) || now - stateTime > oneHour) {
      console.warn('Consent state expired or invalid timestamp');
      return null;
    }

    // Verify signature
    const payload = `${mspOrgId}:${tenantRecordId}:${timestamp}`;
    const secret = getStateSecret();
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex')
      .substring(0, 16);

    if (signature !== expectedSignature) {
      console.warn('Consent state signature mismatch');
      return null;
    }

    return { mspOrgId, tenantRecordId };
  } catch (error) {
    console.error('Error verifying consent state:', error);
    return null;
  }
}

/**
 * Get the base URL for the application
 */
export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_URL) {
    return process.env.NEXT_PUBLIC_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return 'http://localhost:3000';
}

/**
 * Sanitize a string for use in URL parameters
 * Removes potentially dangerous characters
 */
export function sanitizeForUrl(str: string): string {
  return str
    .replace(/[<>'"&]/g, '')
    .substring(0, 200);
}
