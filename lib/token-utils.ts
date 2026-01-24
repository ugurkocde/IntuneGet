/**
 * Token utility functions for MSAL token management
 */

/**
 * Decode JWT token payload without verification
 */
export function decodeToken(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    return payload;
  } catch {
    return null;
  }
}

/**
 * Check if token is expiring soon
 * @param token JWT token string
 * @param thresholdMinutes Minutes before expiry to consider "expiring soon"
 */
export function isTokenExpiringSoon(
  token: string,
  thresholdMinutes: number = 5
): boolean {
  const payload = decodeToken(token);
  if (!payload || typeof payload.exp !== "number") return true;

  const expiryTime = payload.exp * 1000; // Convert to milliseconds
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const now = Date.now();

  return expiryTime - now < thresholdMs;
}

/**
 * Get remaining minutes until token expires
 * @param token JWT token string
 * @returns Remaining minutes or null if invalid token
 */
export function getTokenExpiryMinutes(token: string): number | null {
  const payload = decodeToken(token);
  if (!payload || typeof payload.exp !== "number") return null;

  const expiryTime = payload.exp * 1000;
  const now = Date.now();
  const remainingMs = expiryTime - now;

  if (remainingMs <= 0) return 0;
  return Math.floor(remainingMs / 60000);
}

/**
 * Get user info from token
 */
export function getUserFromToken(token: string): {
  id: string;
  name?: string;
  email?: string;
  tenantId?: string;
} | null {
  const payload = decodeToken(token);
  if (!payload) return null;

  return {
    id: (payload.oid as string) || (payload.sub as string) || "",
    name: payload.name as string | undefined,
    email:
      (payload.preferred_username as string) ||
      (payload.email as string) ||
      undefined,
    tenantId: payload.tid as string | undefined,
  };
}
