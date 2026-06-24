/**
 * Shared consent-aware token acquisition.
 *
 * Both `/api/auth/verify-consent` and `lib/msp/consent-verification.ts`
 * acquire a service-principal token and need to classify acquisition failures
 * consistently so the cart's "Ready to deploy" indicator (verify-consent) and
 * the deployment gate (verifyTenantConsent) cannot disagree on what counts as
 * `consent_not_granted` vs a transient error.
 *
 * The acquisition and AADSTS classification live in lib/azure-app-credential
 * (so the client-secret and managed-identity paths classify the same way);
 * this module just re-exposes them under the consent-specific type names.
 */

import { acquireAppOnlyToken, type AppTokenResult } from '@/lib/azure-app-credential';

export type ConsentTokenResult = AppTokenResult;

/**
 * Acquire a Graph API access token for `tenantId`, returning a discriminated
 * union instead of throwing. Failure modes:
 *
 * - `missing_credentials`: server is misconfigured (invalid/expired client
 *   secret, or no managed identity available).
 * - `consent_not_granted`: tenant has not consented / the identity lacks the
 *   required permissions.
 * - `network_error`: anything else (rate limits, outages, parse failures).
 */
export async function acquireConsentToken(tenantId: string): Promise<ConsentTokenResult> {
  return acquireAppOnlyToken(tenantId);
}
