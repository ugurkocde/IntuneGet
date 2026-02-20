/**
 * Authentication Token Parser
 * Shared utility for parsing and validating JWT tokens from Azure AD.
 * Token authenticity is verified by presenting each token to the Microsoft
 * Graph API so that Microsoft's servers validate the signature, issuer,
 * audience, and expiry on our behalf.
 */

import { parseAccessToken } from '@/lib/auth-utils';

/**
 * Result of parsing an authentication token
 */
export interface ParsedAuthToken {
  userId: string;
  tenantId: string;
  email?: string;
  name?: string;
}

/**
 * Parse and verify an Azure AD access token from the Authorization header.
 * Delegates to parseAccessToken which validates the token against Microsoft
 * Graph before trusting any claims.
 *
 * @param authHeader - The Authorization header value (expected format: "Bearer <token>")
 * @returns Parsed token information or null if invalid/missing/unverified
 */
export async function parseAuthToken(authHeader: string | null): Promise<ParsedAuthToken | null> {
  const info = await parseAccessToken(authHeader);
  if (!info) return null;
  return {
    userId: info.userId,
    tenantId: info.tenantId,
    email: info.userEmail !== 'unknown' ? info.userEmail : undefined,
    name: info.userName ?? undefined,
  };
}

/**
 * Validate that the parsed token contains required fields
 */
export function validateAuthToken(token: ParsedAuthToken | null): token is ParsedAuthToken {
  return token !== null &&
    typeof token.userId === 'string' &&
    token.userId.length > 0 &&
    typeof token.tenantId === 'string' &&
    token.tenantId.length > 0;
}

/**
 * Helper to get auth info from a request, with validation.
 * Returns the auth info or null if invalid/missing/unverified.
 */
export async function getAuthFromRequest(request: { headers: { get(name: string): string | null } }): Promise<ParsedAuthToken | null> {
  const authHeader = request.headers.get('Authorization');
  const token = await parseAuthToken(authHeader);
  return validateAuthToken(token) ? token : null;
}
