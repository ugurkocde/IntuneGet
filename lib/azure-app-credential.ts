/**
 * App-only Microsoft Graph token acquisition.
 *
 * Single source of truth for acquiring a service-principal (app-only) Graph
 * access token. Two modes:
 *
 *  - secret (default): the app registration's client-credentials flow with a
 *    client secret. Unchanged behavior for existing/hosted deployments.
 *
 *  - managed-identity: authenticate AS an Azure managed identity via
 *    @azure/identity - no client secret and nothing stored on disk. Opt in with
 *    AZURE_AUTH_MODE=managed-identity. The managed identity must be granted the
 *    required Microsoft Graph application permissions (app roles) directly (see
 *    docs/SELF_HOSTING.md). The token is issued for the managed identity's home
 *    tenant, so this is intended for single-tenant self-hosting on Azure
 *    (App Service, Container Apps, AKS, or a VM with IMDS).
 *
 * Returns a discriminated union (never throws) so callers can classify
 * failures consistently:
 *  - missing_credentials : not configured / no managed identity available.
 *  - consent_not_granted : tenant/identity lacks the required permissions.
 *  - network_error       : transient (rate limit, outage, parse failure).
 */

import { ManagedIdentityCredential } from '@azure/identity';

const GRAPH_DEFAULT_SCOPE = 'https://graph.microsoft.com/.default';

export type AppTokenError =
  | 'missing_credentials'
  | 'consent_not_granted'
  | 'network_error';

export type AppTokenResult =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; error: AppTokenError; errorCode?: string; errorDescription?: string };

/** Whether app-only auth should use an Azure managed identity instead of a secret. */
export function isManagedIdentityMode(): boolean {
  return (process.env.AZURE_AUTH_MODE || '').trim().toLowerCase() === 'managed-identity';
}

function resolveClientId(): string | undefined {
  return (
    process.env.AZURE_CLIENT_ID ||
    process.env.AZURE_AD_CLIENT_ID ||
    process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID
  );
}

// Lazily constructed singleton; @azure/identity caches tokens internally too.
let managedIdentityCredential: ManagedIdentityCredential | undefined;
function getManagedIdentityCredential(): ManagedIdentityCredential {
  if (!managedIdentityCredential) {
    // AZURE_MANAGED_IDENTITY_CLIENT_ID selects a user-assigned identity; omit
    // it for the system-assigned identity.
    const clientId = process.env.AZURE_MANAGED_IDENTITY_CLIENT_ID;
    managedIdentityCredential = clientId
      ? new ManagedIdentityCredential({ clientId })
      : new ManagedIdentityCredential();
  }
  return managedIdentityCredential;
}

/**
 * Acquire an app-only Microsoft Graph access token for `tenantId`.
 * In managed-identity mode the tenant is the managed identity's home tenant and
 * `tenantId` is ignored.
 */
export async function acquireAppOnlyToken(tenantId: string): Promise<AppTokenResult> {
  return isManagedIdentityMode()
    ? acquireViaManagedIdentity()
    : acquireViaClientSecret(tenantId);
}

async function acquireViaManagedIdentity(): Promise<AppTokenResult> {
  try {
    const token = await getManagedIdentityCredential().getToken(GRAPH_DEFAULT_SCOPE);
    if (!token?.token) {
      return { ok: false, error: 'missing_credentials' };
    }
    const expiresIn = Math.max(
      0,
      Math.round((token.expiresOnTimestamp - Date.now()) / 1000)
    );
    return { ok: true, accessToken: token.token, expiresIn };
  } catch (error) {
    const name = (error as { name?: string })?.name || '';
    const message = error instanceof Error ? error.message : String(error);
    // No managed identity available (not on Azure / not configured) is a
    // configuration problem; everything else is treated as transient.
    if (name === 'CredentialUnavailableError') {
      return { ok: false, error: 'missing_credentials', errorDescription: message };
    }
    return { ok: false, error: 'network_error', errorDescription: message };
  }
}

async function acquireViaClientSecret(tenantId: string): Promise<AppTokenResult> {
  const clientId = resolveClientId();
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
          scope: GRAPH_DEFAULT_SCOPE,
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
      return { ok: true, accessToken: tokenData.access_token, expiresIn: tokenData.expires_in };
    } catch {
      return { ok: false, error: 'network_error' };
    }
  }

  const errorData = await response.json().catch(() => ({}));
  const errorCode: string | undefined = errorData.error;
  const errorDescription: string = errorData.error_description || '';

  // Server misconfiguration: invalid or expired client secret.
  if (
    errorCode === 'invalid_client' ||
    errorDescription.includes('AADSTS7000215') ||
    errorDescription.includes('AADSTS7000222')
  ) {
    return { ok: false, error: 'missing_credentials', errorCode, errorDescription };
  }

  // Tenant has not consented (or app not yet present in tenant).
  if (
    errorCode === 'invalid_grant' ||
    errorCode === 'unauthorized_client' ||
    errorDescription.includes('AADSTS700016') ||
    errorDescription.includes('AADSTS65001')
  ) {
    return { ok: false, error: 'consent_not_granted', errorCode, errorDescription };
  }

  return { ok: false, error: 'network_error', errorCode, errorDescription };
}
