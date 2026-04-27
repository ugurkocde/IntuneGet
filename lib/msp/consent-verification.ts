/**
 * Tenant Consent Verification
 * Shared module for verifying admin consent via client credentials flow.
 *
 * Used by the deployment gate (/api/package) to ensure jobs aren't queued
 * when the upload would ultimately fail due to missing consent or perms.
 *
 * Uses the shared `acquireConsentToken` so error classification matches
 * the user-facing /api/auth/verify-consent endpoint exactly.
 */

import { acquireConsentToken } from '@/lib/consent-token';

export type ConsentVerifyError =
  | 'missing_credentials'
  | 'consent_not_granted'
  | 'insufficient_intune_permissions'
  | 'network_error'
  | null;

export interface ConsentVerifyResult {
  verified: boolean;
  error?: ConsentVerifyError;
}

/**
 * Verify that admin consent has been granted for the tenant.
 *
 * Returns:
 * - `{ verified: true }` if consent is granted AND the required Intune
 *   permission is present
 * - `{ verified: false, error: 'consent_not_granted' }` only when Microsoft
 *   reports a real consent failure (AADSTS65001 / AADSTS700016 etc)
 * - `{ verified: false, error: 'insufficient_intune_permissions' }` when
 *   token is acquired but `DeviceManagementApps.ReadWrite.All` is missing
 *   or the live Graph test returns 401/403
 * - `{ verified: false, error: 'missing_credentials' }` for server-side
 *   misconfiguration (invalid/expired client secret)
 * - `{ verified: false, error: 'network_error' }` for transient failures
 *   (rate limits, Microsoft outages, timeouts) — callers should treat
 *   this as "could not verify, please retry" not "consent denied"
 *
 * Retries once on `network_error` to absorb single-shot blips.
 */
export async function verifyTenantConsent(tenantId: string): Promise<ConsentVerifyResult> {
  // First attempt
  let result = await verifyTenantConsentOnce(tenantId);

  // Retry once on transient failure to avoid misclassifying single blips
  // as deployment-blocking consent errors.
  if (result.error === 'network_error') {
    await new Promise((resolve) => setTimeout(resolve, 500));
    result = await verifyTenantConsentOnce(tenantId);
  }

  return result;
}

async function verifyTenantConsentOnce(tenantId: string): Promise<ConsentVerifyResult> {
  const tokenResult = await acquireConsentToken(tenantId);

  if (!tokenResult.ok) {
    // missing_credentials | consent_not_granted | network_error
    return { verified: false, error: tokenResult.error };
  }

  const accessToken = tokenResult.accessToken;

  // Token obtained — check roles claim for explicit permission verification
  try {
    const tokenPayload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64').toString()
    );
    const roles: string[] = tokenPayload.roles || [];

    if (!roles.includes('DeviceManagementApps.ReadWrite.All')) {
      return { verified: false, error: 'insufficient_intune_permissions' };
    }
  } catch {
    // Fall through to API test as backup
  }

  // Secondary validation: test actual Intune API access
  let intuneTestResponse: Response;
  try {
    intuneTestResponse = await fetch(
      'https://graph.microsoft.com/beta/deviceAppManagement/mobileApps?$top=1&$select=id',
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch {
    return { verified: false, error: 'network_error' };
  }

  if (intuneTestResponse.status === 401 || intuneTestResponse.status === 403) {
    return { verified: false, error: 'insufficient_intune_permissions' };
  }

  if (intuneTestResponse.status >= 500) {
    return { verified: false, error: 'network_error' };
  }

  if (!intuneTestResponse.ok) {
    return { verified: false, error: 'network_error' };
  }

  return { verified: true };
}
