/**
 * Authentication Utilities
 * Shared utilities for parsing and validating authentication tokens
 */

import crypto from 'crypto';
import { decodeJwt } from 'jose';

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
 * In-process cache for verified tokens to avoid a Graph round-trip on every request.
 * Keyed by SHA-256 hash of the raw token; value carries the verified claims and
 * the wall-clock time at which the cache entry expires.
 */
const _tokenCache = new Map<string, { result: TokenUserInfo; expiresAt: number }>();

/** Maximum age of a cache entry, regardless of token expiry (5 minutes). */
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

function _tokenCacheKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Validate a Microsoft Graph access token by presenting it to the Graph /me
 * endpoint. Microsoft's own servers verify the signature, issuer, audience and
 * expiry; if the call succeeds we know the token is genuine and the claims it
 * carries are trustworthy.
 *
 * Results are cached for min(token-expiry, TOKEN_CACHE_TTL_MS) so that
 * subsequent requests with the same token incur no extra latency.
 */
async function verifyTokenWithGraph(accessToken: string): Promise<TokenUserInfo | null> {
  const cacheKey = _tokenCacheKey(accessToken);
  const now = Date.now();

  const cached = _tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  // Evict stale entries when the map grows large (best-effort housekeeping).
  if (_tokenCache.size > 1000) {
    for (const [key, entry] of _tokenCache) {
      if (entry.expiresAt <= now) _tokenCache.delete(key);
    }
  }

  try {
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      // Token was rejected by Microsoft — do not trust it.
      return null;
    }

    const me = await response.json();

    // Decode (not verify) the payload only to read the tenant ID (tid).  The
    // Graph call above has already authenticated the token, so reading tid here
    // is safe — an attacker cannot forge a tid that Microsoft would accept.
    const payload = decodeJwt(accessToken);
    const tenantId = payload.tid as string | undefined;

    if (!me.id || !tenantId) {
      return null;
    }

    const result: TokenUserInfo = {
      userId: me.id as string,
      userEmail: ((me.userPrincipalName || me.mail || 'unknown') as string),
      tenantId,
      userName: (me.displayName as string) || null,
    };

    // Cache until the token expires or TTL elapses, whichever comes first.
    const tokenExpMs =
      typeof payload.exp === 'number' ? payload.exp * 1000 : now + TOKEN_CACHE_TTL_MS;
    _tokenCache.set(cacheKey, { result, expiresAt: Math.min(tokenExpMs, now + TOKEN_CACHE_TTL_MS) });

    return result;
  } catch (error) {
    console.error('Token verification failed:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Parse and verify a Microsoft Graph access token from an Authorization header.
 * The token's authenticity is confirmed by presenting it to the Microsoft Graph
 * API — Microsoft verifies the signature, issuer, audience, and expiry.
 * Results are cached to minimise latency on hot paths.
 */
export async function parseAccessToken(authHeader: string | null): Promise<TokenUserInfo | null> {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const accessToken = authHeader.slice(7);
  if (accessToken.split('.').length !== 3) {
    return null;
  }

  return verifyTokenWithGraph(accessToken);
}

/**
 * Response from Microsoft Graph /me endpoint
 */
interface GraphMeResponse {
  mail?: string | null;
  userPrincipalName?: string | null;
  otherMails?: (string | null)[];
}

/**
 * Resolve all known email addresses for the signed-in user via Microsoft Graph API.
 * Uses the user's delegated access token (User.Read scope) to call GET /me.
 * Returns a Set of lowercased email addresses, or null if the Graph call fails.
 */
export async function resolveUserEmails(authHeader: string): Promise<Set<string> | null> {
  try {
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,otherMails',
      {
        headers: { Authorization: authHeader },
      }
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unable to read error body');
      console.warn(`Graph /me call failed with status ${response.status}: ${errorBody}`);
      return null;
    }

    const data: GraphMeResponse = await response.json();

    const emails = new Set<string>();

    if (data.mail) {
      emails.add(data.mail.toLowerCase());
    }
    if (data.userPrincipalName) {
      emails.add(data.userPrincipalName.toLowerCase());
    }
    if (data.otherMails) {
      for (const email of data.otherMails) {
        if (email) {
          emails.add(email.toLowerCase());
        }
      }
    }

    return emails.size > 0 ? emails : null;
  } catch (error) {
    console.warn('Failed to resolve user emails via Graph API:', error instanceof Error ? error.message : 'Unknown error');
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
  const clientSecret = process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;
  if (clientSecret) {
    return crypto.createHash('sha256').update(clientSecret + '_msp_state').digest('hex');
  }

  // In development, use a fixed secret (not secure for production)
  if (process.env.NODE_ENV === 'development') {
    return 'dev-state-secret-not-for-production';
  }

  throw new Error('MSP_STATE_SECRET or AZURE_CLIENT_SECRET/AZURE_AD_CLIENT_SECRET must be set');
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
