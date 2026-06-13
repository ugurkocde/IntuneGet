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

export const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

// Module-scoped token cache keyed by tenantId
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const tokenInflight = new Map<string, Promise<string | null>>();

/**
 * Fetch with retry logic for Graph API rate limiting (429) and transient errors (5xx).
 * Respects Retry-After header; falls back to exponential backoff capped at 30s.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
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
  const clientId = process.env.AZURE_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Service principal token failure: missing AZURE_CLIENT_ID or AZURE_CLIENT_SECRET');
    return null;
  }

  try {
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      }
    );

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text().catch(() => 'unknown error');
      console.error(`Service principal token failure for tenant ${tenantId}: ${tokenResponse.status} - ${errorText}`);
      tokenCache.delete(tenantId);
      return null;
    }

    const tokenData = await tokenResponse.json();
    const token = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 3600;
    tokenCache.set(tenantId, {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    return token;
  } catch (error) {
    console.error('Service principal token error:', error);
    tokenCache.delete(tenantId);
    return null;
  }
}
