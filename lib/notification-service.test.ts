import { describe, expect, it, vi } from 'vitest';
const { from, insert } = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ createServerClient: () => ({ from }) }));
import { notifyAutoUpdatePaused } from './notification-service';
describe('automatic pause notices', () => {
  it.each(['fixture-owner@example.invalid', null])('uses only the owner profile email or skips a missing email: %s', async email => {
    insert.mockClear();
    const eq = vi.fn();
    from.mockImplementation((table: string) => {
      const b = { select: vi.fn(() => b), eq: eq.mockImplementation(() => b), maybeSingle: vi.fn(async () => ({ data: { email }, error: null })), insert: insert.mockResolvedValue({ error: null }) };
      expect(['user_profiles', 'user_notifications']).toContain(table); return b;
    });
    await notifyAutoUpdatePaused({ userId: 'fixture-owner', policyId: 'fixture-policy', wingetId: 'Fixture.App', tenantId: 'fixture-tenant', failures: 3, lastError: 'Fixture failure' });
    expect(eq).toHaveBeenCalledWith('id', 'fixture-owner');
    expect(insert).toHaveBeenCalledTimes(email ? 1 : 0);
    if (email) expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'fixture-owner', user_email: email, type: 'update_available', title: 'Automatic updates paused: Fixture.App', message: 'Fixture failure', data: { kind: 'auto_update_paused', policy_id: 'fixture-policy', winget_id: 'Fixture.App', tenant_id: 'fixture-tenant', failures: 3 } }));
  });
});
