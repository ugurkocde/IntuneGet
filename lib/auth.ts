/**
 * Authentication Utilities
 * Server-side helpers for token validation.
 */

import { parseAccessToken } from './auth-utils';

/**
 * User info extracted from token
 */
export interface TokenUser {
  id: string;
  name?: string;
  email?: string;
  tenantId?: string;
}

/**
 * Validate an access token by verifying it against the Microsoft Graph API.
 * Returns user claims only if Microsoft confirms the token is authentic.
 */
export async function validateToken(accessToken: string): Promise<TokenUser | null> {
  if (!accessToken) return null;

  try {
    const info = await parseAccessToken(`Bearer ${accessToken}`);
    if (!info) return null;

    return {
      id: info.userId,
      name: info.userName ?? undefined,
      email: info.userEmail !== 'unknown' ? info.userEmail : undefined,
      tenantId: info.tenantId,
    };
  } catch (error) {
    console.error('Token validation error:', error);
    return null;
  }
}

/**
 * Check if Entra ID client ID is configured
 */
export function isAzureAdConfigured(): boolean {
  return Boolean(process.env.AZURE_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID);
}
