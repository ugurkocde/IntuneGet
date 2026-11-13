/**
 * Shared secret authorization for cron and maintenance routes
 */

import { timingSafeEqual } from 'node:crypto';

/**
 * Check an Authorization header against "Bearer <secret>".
 * Fails closed: with no configured secret nothing is authorized, so the
 * literal header "Bearer undefined" can never pass.
 */
export function isBearerSecret(
  authorizationHeader: string | null,
  secret: string | undefined
): boolean {
  if (!secret || !authorizationHeader) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(authorizationHeader);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/**
 * True when the request carries the configured CRON_SECRET as a bearer token.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  return isBearerSecret(request.headers.get('authorization'), process.env.CRON_SECRET);
}
