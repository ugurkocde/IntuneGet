/**
 * Shared consent-aware token acquisition.
 *
 * Both `/api/auth/verify-consent` and `lib/msp/consent-verification.ts`
 * acquire a service-principal token via client credentials and need to
 * classify token-endpoint failures consistently. This helper centralises
 * the AADSTS classification so the cart's "Ready to deploy" indicator
 * (verify-consent) and the deployment gate (verifyTenantConsent) cannot
 * disagree on what counts as `consent_not_granted` vs a transient error.
 */

export type ConsentTokenError =
  | 'missing_credentials'
  | 'consent_not_granted'
  | 'network_error';

export type ConsentTokenResult =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; error: ConsentTokenError; errorCode?: string; errorDescription?: string };

/**
 * Acquire a Graph API access token for `tenantId` via client credentials,
 * returning a discriminated union instead of throwing. Failure modes are
 * classified by AADSTS error codes:
 *
 * - `missing_credentials`: server is misconfigured (invalid/expired client
 *   secret) — `invalid_client`, `AADSTS7000215`, `AADSTS7000222`.
 * - `consent_not_granted`: tenant has not consented — `invalid_grant`,
 *   `unauthorized_client`, `AADSTS700016`, `AADSTS65001`.
 * - `network_error`: anything else (rate limits, Microsoft outages,
 *   timeouts, JSON parse failures). Callers should treat this as
 *   transient and may retry.
 */
export async function acquireConsentToken(tenantId: string): Promise<ConsentTokenResult> {
  const clientId = process.env.AZURE_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { ok: false, error: 'missing_credentials' };
  }

  let response: Response;
  try {
    response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }).toString(),
      }
    );
  } catch {
    return { ok: false, error: 'network_error' };
  }

  if (response.ok) {
    try {
      const tokenData = await response.json();
      return {
        ok: true,
        accessToken: tokenData.access_token,
        expiresIn: tokenData.expires_in,
      };
    } catch {
      return { ok: false, error: 'network_error' };
    }
  }

  const errorData = await response.json().catch(() => ({}));
  const errorCode: string | undefined = errorData.error;
  const errorDescription: string = errorData.error_description || '';

  // Server misconfiguration: invalid or expired client secret
  if (
    errorCode === 'invalid_client' ||
    errorDescription.includes('AADSTS7000215') ||
    errorDescription.includes('AADSTS7000222')
  ) {
    return { ok: false, error: 'missing_credentials', errorCode, errorDescription };
  }

  // Tenant has not consented (or app not yet present in tenant)
  if (
    errorCode === 'invalid_grant' ||
    errorCode === 'unauthorized_client' ||
    errorDescription.includes('AADSTS700016') ||
    errorDescription.includes('AADSTS65001')
  ) {
    return { ok: false, error: 'consent_not_granted', errorCode, errorDescription };
  }

  // Anything else is treated as transient. Callers may retry.
  return { ok: false, error: 'network_error', errorCode, errorDescription };
}
