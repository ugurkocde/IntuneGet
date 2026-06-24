/**
 * Graph API Token Acquisition
 * Shared utility for obtaining app-only access tokens. Used by consent
 * verification and store app deployment.
 */

import { acquireAppOnlyToken } from '@/lib/azure-app-credential';

export interface GraphTokenResult {
  accessToken: string;
  expiresIn: number;
}

/**
 * Acquire a Graph API access token for the given tenant. Uses the app
 * registration's client secret by default, or an Azure managed identity when
 * AZURE_AUTH_MODE=managed-identity (see lib/azure-app-credential).
 */
export async function acquireGraphToken(tenantId: string): Promise<GraphTokenResult> {
  const result = await acquireAppOnlyToken(tenantId);
  if (!result.ok) {
    throw new Error(
      `Token acquisition failed (${result.error})${result.errorDescription ? `: ${result.errorDescription}` : ''}`
    );
  }
  return { accessToken: result.accessToken, expiresIn: result.expiresIn };
}
