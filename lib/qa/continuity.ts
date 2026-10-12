const MAX_CONTINUITY_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Allows an explicit customer upload to continue while its exact VM lifecycle
 * remains queued. The server-only, expiring switch cannot be enabled from a
 * client payload and cannot silently become a permanent QA bypass.
 */
export function isDeferredCustomerQaEnabled(
  now = new Date(),
  configuredUntil = process.env.QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL
): boolean {
  const value = configuredUntil?.trim();
  if (!value) return false;

  const expiresAt = Date.parse(value);
  if (!Number.isFinite(expiresAt)) return false;

  const remainingMs = expiresAt - now.getTime();
  return remainingMs > 0 && remainingMs <= MAX_CONTINUITY_WINDOW_MS;
}
