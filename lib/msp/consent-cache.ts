/**
 * Tenant consent cache helpers backed by the Supabase `tenant_consent` table.
 *
 * Both /api/auth/verify-consent (records the result of an authoritative
 * verification) and /api/package (consults the cache before deciding whether
 * to gate a deployment) share these primitives so the two paths can't drift.
 */

import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

// Records older than this are treated as expired and will trigger a fresh
// live verification. Bounds the window in which a silently-revoked consent
// at the IdP can still be trusted by the deployment fast path.
const STORED_CONSENT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Returns true if a tenant has an active consent record younger than the
 * staleness threshold.
 *
 * This is a hint, not authoritative — consent could have been revoked at the
 * IdP since the record was written. The 24h max-age means revocations are
 * caught within a day even without an explicit cache invalidation event.
 * Callers that need a hard guarantee should still verify against Microsoft.
 */
export async function checkStoredConsent(tenantId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('tenant_consent')
      .select('is_active, updated_at, consent_granted_at')
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data || data.is_active !== true) return false;

    // updated_at tracks the last successful verification (storeConsentRecord
    // refreshes it on every verified hit). Fall back to consent_granted_at
    // for older rows that predate the upsert pattern.
    const lastVerifiedRaw = data.updated_at ?? data.consent_granted_at;
    if (!lastVerifiedRaw) return false;

    const lastVerifiedMs = Date.parse(lastVerifiedRaw);
    if (Number.isNaN(lastVerifiedMs)) return false;

    return Date.now() - lastVerifiedMs < STORED_CONSENT_MAX_AGE_MS;
  } catch {
    return false;
  }
}

/**
 * Persist a successful consent verification so other routes can short-circuit.
 */
export async function storeConsentRecord(
  tenantId: string,
  userId: string,
  userEmail: string
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = createServerClient();
    await supabase.from('tenant_consent').upsert(
      {
        tenant_id: tenantId,
        consented_by_user_id: userId,
        consented_by_email: userEmail,
        consent_granted_at: new Date().toISOString(),
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' }
    );
  } catch {
    // Failed to store consent record - continue silently
  }
}

/**
 * Mark a stored consent record as inactive (consent revoked or expired).
 */
export async function clearStoredConsent(tenantId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = createServerClient();
    await supabase
      .from('tenant_consent')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId);
  } catch {
    // Failed to clear consent record - continue silently
  }
}
