/**
 * Microsoft Graph client helpers (service-principal / app-only)
 *
 * Shared Graph plumbing for Intune API routes that authenticate with the
 * service principal (client-credentials flow) rather than a delegated user
 * token: a retrying fetch and a per-tenant token cache.
 *
 * NOTE: this is currently consumed only by the detected-app-devices route.
 * Several other routes still define their own copies of this logic; converging
 * them onto this module is a deliberate follow-up, not a drive-by change.
 */

import { acquireAppOnlyToken } from '@/lib/azure-app-credential';

export const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

// Hard ceiling on a single Graph request. A heavily throttled tenant can hold
// the connection open instead of returning 429 promptly; without this an
// in-flight fetch would run toward the route's maxDuration and hang the client.
const PER_REQUEST_TIMEOUT_MS = 20_000;

// Module-scoped token cache keyed by tenantId
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const tokenInflight = new Map<string, Promise<string | null>>();

/**
 * Fetch with retry logic for Graph API rate limiting (429) and transient errors (5xx).
 * Respects Retry-After header; falls back to exponential backoff capped at 30s.
 *
 * Each request is bounded by a per-request timeout (and any caller-supplied
 * signal), so a stalled Graph connection is aborted and retried rather than
 * hanging the function until its maxDuration limit.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const signals = [AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS)];
    if (options.signal) {
      signals.push(options.signal);
    }

    let response: Response;
    try {
      response = await fetch(url, { ...options, signal: AbortSignal.any(signals) });
    } catch (err) {
      // Per-request timeout / abort or a transient network error: retry within
      // the attempt budget, then surface the error on the final attempt.
      if (attempt === maxRetries) {
        throw err;
      }
      const delayMs = Math.min(Math.pow(2, attempt) * 1000, 30000);
      console.warn(
        `Graph API request error on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delayMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    const status = response.status;
    const isRetryable = status === 429 || status >= 500;
    if (!isRetryable || attempt === maxRetries) {
      return response;
    }

    // Consume body to prevent memory leaks in serverless
    await response.text().catch(() => {});

    const retryAfter = response.headers.get('Retry-After');
    let delayMs: number;
    if (retryAfter) {
      const parsed = Number(retryAfter);
      delayMs = Number.isNaN(parsed) ? Math.pow(2, attempt) * 1000 : parsed * 1000;
    } else {
      delayMs = Math.pow(2, attempt) * 1000;
    }
    delayMs = Math.min(delayMs, 30000);

    console.warn(
      `Graph API ${status} on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delayMs}ms`
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // Unreachable: loop always returns on attempt === maxRetries
  throw new Error('Failed to fetch data from Intune');
}

/**
 * Get an access token for the service principal using the client-credentials
 * flow. Tokens are cached per tenant (with a 10-minute pre-expiry buffer) and
 * concurrent fetches for the same tenant are deduplicated.
 */
export async function getServicePrincipalToken(tenantId: string): Promise<string | null> {
  // Return cached token if still valid (with 10-min buffer)
  const cached = tokenCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now() + 10 * 60 * 1000) {
    return cached.token;
  }

  // Deduplicate concurrent token fetches for the same tenant
  const inflight = tokenInflight.get(tenantId);
  if (inflight) return inflight;

  const promise = fetchServicePrincipalToken(tenantId).finally(() => {
    tokenInflight.delete(tenantId);
  });
  tokenInflight.set(tenantId, promise);
  return promise;
}

/**
 * Invalidate the cached service-principal token for a tenant. Call this when
 * Graph returns 401 (token revoked/expired) so the next request re-acquires.
 */
export function invalidateServicePrincipalToken(tenantId: string): void {
  tokenCache.delete(tenantId);
}

async function fetchServicePrincipalToken(tenantId: string): Promise<string | null> {
  const result = await acquireAppOnlyToken(tenantId);
  if (!result.ok) {
    console.error(
      `Service principal token failure for tenant ${tenantId}: ${result.error}` +
        (result.errorDescription ? ` - ${result.errorDescription}` : '')
    );
    tokenCache.delete(tenantId);
    return null;
  }

  const expiresIn = result.expiresIn || 3600;
  tokenCache.set(tenantId, {
    token: result.accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return result.accessToken;
}
