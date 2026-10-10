import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendEmailMock, isEmailConfiguredMock, deliverWebhookMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
  isEmailConfiguredMock: vi.fn(),
  deliverWebhookMock: vi.fn(),
}));

vi.mock('@/lib/email/service', () => ({
  sendUpdateNotificationEmail: sendEmailMock,
  isEmailConfigured: isEmailConfiguredMock,
}));
vi.mock('@/lib/webhooks/service', () => ({
  deliverWebhook: deliverWebhookMock,
}));

import { notifyUserOfPendingUpdates } from '@/lib/notifications/notify-user';

// Minimal chainable Supabase stub. Per-table results; webhook_configurations is
// awaited as a thenable list, prefs/profile via maybeSingle.
function makeSupabase(
  tables: Record<string, unknown>,
  calls: { markNotified: string[][]; histInserts: string[] },
  errors: Record<string, string> = {}
) {
  function builder(table: string) {
    const b: any = {
      select: () => b,
      eq: () => b,
      is: () => b,
      order: () => b,
      maybeSingle: () => Promise.resolve({ data: tables[table] ?? null, error: null }),
      insert: (row: any) => { if (table === 'notification_history') calls.histInserts.push(row.status); return Promise.resolve({ data: null, error: null }); },
      update: () => ({
        eq: () => Promise.resolve({ data: null, error: null }),
        in: (_c: string, ids: string[]) => { if (table === 'update_check_results') calls.markNotified.push(ids); return Promise.resolve({ data: null, error: null }); },
      }),
      then: (res: any) =>
        res(
          errors[table]
            ? { data: null, error: { message: errors[table] } }
            : { data: tables[table] ?? [], error: null }
        ),
    };
    return b;
  }
  return { from: (t: string) => builder(t) } as any;
}

describe('notifyUserOfPendingUpdates', () => {
  beforeEach(() => {
    sendEmailMock.mockReset();
    isEmailConfiguredMock.mockReset();
    deliverWebhookMock.mockReset();
  });

  it('sends email + webhook and marks the update notified', async () => {
    isEmailConfiguredMock.mockReturnValue(true);
    sendEmailMock.mockResolvedValue({ success: true });
    deliverWebhookMock.mockResolvedValue({ success: true });

    const calls = { markNotified: [] as string[][], histInserts: [] as string[] };
    const supabase = makeSupabase({
      notification_preferences: { user_id: 'u1', email_enabled: true, email_frequency: 'daily', notify_critical_only: false, email_address: 'u1@test.com' },
      webhook_configurations: [{ id: 'w1', user_id: 'u1', name: 'WH', is_enabled: true, failure_count: 0 }],
      user_profiles: { id: 'u1', email: 'u1@test.com', name: 'User One', tenant_name: 'Tenant' },
    }, calls);

    const pending = [{ id: 'upd1', user_id: 'u1', tenant_id: 't1', winget_id: 'Google.Chrome', intune_app_id: 'a1', display_name: 'Chrome', current_version: '1.0', latest_version: '2.0', is_critical: false }] as any;

    const res = await notifyUserOfPendingUpdates(supabase, 'u1', { pendingUpdates: pending });

    expect(res.emailsSent).toBe(1);
    expect(res.webhooksSent).toBe(1);
    expect(res.notifiedUpdateIds).toEqual(['upd1']);
    expect(calls.markNotified.flat()).toContain('upd1');
    expect(calls.histInserts).toEqual(['sent', 'sent']);
  });

  it('does NOT mark notified when all channels fail (retried next run)', async () => {
    isEmailConfiguredMock.mockReturnValue(true);
    sendEmailMock.mockResolvedValue({ success: false, error: 'smtp down' });
    deliverWebhookMock.mockResolvedValue({ success: false, error: 'HTTP 403' });

    const calls = { markNotified: [] as string[][], histInserts: [] as string[] };
    const supabase = makeSupabase({
      notification_preferences: { user_id: 'u1', email_enabled: true, email_frequency: 'daily', notify_critical_only: false, email_address: 'u1@test.com' },
      webhook_configurations: [{ id: 'w1', user_id: 'u1', name: 'WH', is_enabled: true, failure_count: 0 }],
      user_profiles: { id: 'u1', email: 'u1@test.com', name: 'User One', tenant_name: 'Tenant' },
    }, calls);

    const pending = [{ id: 'upd1', user_id: 'u1', tenant_id: 't1', winget_id: 'Google.Chrome', intune_app_id: 'a1', display_name: 'Chrome', current_version: '1.0', latest_version: '2.0', is_critical: false }] as any;

    const res = await notifyUserOfPendingUpdates(supabase, 'u1', { pendingUpdates: pending });

    expect(res.notifiedUpdateIds).toEqual([]);
    expect(calls.markNotified.flat()).not.toContain('upd1');
  });

  describe('per-app update policies', () => {
    const prefs = { user_id: 'u1', email_enabled: true, email_frequency: 'daily', notify_critical_only: false, email_address: 'u1@test.com' };
    const webhooks = [{ id: 'w1', user_id: 'u1', name: 'WH', is_enabled: true, failure_count: 0 }];
    const profile = { id: 'u1', email: 'u1@test.com', name: 'User One', tenant_name: 'Tenant' };

    function row(id: string, wingetId: string, latestVersion: string, extra: Record<string, unknown> = {}) {
      return { id, user_id: 'u1', tenant_id: 't1', winget_id: wingetId, intune_app_id: `app-${id}`, display_name: wingetId, current_version: '1.0', latest_version: latestVersion, is_critical: false, ...extra };
    }

    function policy(wingetId: string, policyType: string, extra: Record<string, unknown> = {}) {
      return { id: `p-${wingetId}`, user_id: 'u1', tenant_id: 't1', winget_id: wingetId, policy_type: policyType, pinned_version: null, is_enabled: true, consecutive_failures: 0, ...extra };
    }

    function notifiedApps(): string[] {
      const payloads = [
        ...sendEmailMock.mock.calls.map((c: any[]) => c[1]),
        ...deliverWebhookMock.mock.calls.map((c: any[]) => c[1]),
      ];
      return [...new Set(payloads.flatMap((p: any) => p.updates.map((u: any) => u.winget_id)))].sort();
    }

    beforeEach(() => {
      isEmailConfiguredMock.mockReturnValue(true);
      sendEmailMock.mockResolvedValue({ success: true });
      deliverWebhookMock.mockResolvedValue({ success: true });
    });

    it('does not notify an ignored app and leaves its row pending', async () => {
      const calls = { markNotified: [] as string[][], histInserts: [] as string[] };
      const supabase = makeSupabase({
        notification_preferences: prefs,
        webhook_configurations: webhooks,
        user_profiles: profile,
        app_update_policies: [policy('Ignored.App', 'ignore')],
      }, calls);

      const res = await notifyUserOfPendingUpdates(supabase, 'u1', {
        pendingUpdates: [row('upd1', 'Google.Chrome', '2.0'), row('upd2', 'Ignored.App', '2.0')] as any,
      });

      expect(notifiedApps()).toEqual(['Google.Chrome']);
      expect(res.notifiedUpdateIds).toEqual(['upd1']);
      expect(calls.markNotified.flat()).not.toContain('upd2');
    });

    it('sends nothing when every pending update is ignored', async () => {
      const calls = { markNotified: [] as string[][], histInserts: [] as string[] };
      const supabase = makeSupabase({
        notification_preferences: prefs,
        webhook_configurations: webhooks,
        user_profiles: profile,
        app_update_policies: [policy('Ignored.App', 'ignore')],
      }, calls);

      const res = await notifyUserOfPendingUpdates(supabase, 'u1', {
        pendingUpdates: [row('upd2', 'Ignored.App', '2.0')] as any,
      });

      expect(sendEmailMock).not.toHaveBeenCalled();
      expect(deliverWebhookMock).not.toHaveBeenCalled();
      expect(calls.histInserts).toEqual([]);
      expect(res.notifiedUpdateIds).toEqual([]);
      expect(calls.markNotified.flat()).toEqual([]);
    });

    it('only notifies a pinned app when the update is the pinned version', async () => {
      const calls = { markNotified: [] as string[][], histInserts: [] as string[] };
      const supabase = makeSupabase({
        notification_preferences: prefs,
        webhook_configurations: webhooks,
        user_profiles: profile,
        app_update_policies: [
          policy('Pinned.Beyond', 'pin_version', { pinned_version: '1.5' }),
          policy('Pinned.Match', 'pin_version', { pinned_version: '1.5' }),
        ],
      }, calls);

      const res = await notifyUserOfPendingUpdates(supabase, 'u1', {
        pendingUpdates: [row('upd3', 'Pinned.Beyond', '2.0'), row('upd4', 'Pinned.Match', '1.5')] as any,
      });

      expect(notifiedApps()).toEqual(['Pinned.Match']);
      expect(res.notifiedUpdateIds).toEqual(['upd4']);
      expect(calls.markNotified.flat()).not.toContain('upd3');
    });

    it('applies a policy only to the tenant it belongs to', async () => {
      const calls = { markNotified: [] as string[][], histInserts: [] as string[] };
      const supabase = makeSupabase({
        notification_preferences: prefs,
        webhook_configurations: webhooks,
        user_profiles: profile,
        app_update_policies: [policy('Google.Chrome', 'ignore', { tenant_id: 't2' })],
      }, calls);

      const res = await notifyUserOfPendingUpdates(supabase, 'u1', {
        pendingUpdates: [row('upd1', 'Google.Chrome', '2.0')] as any,
      });

      expect(notifiedApps()).toEqual(['Google.Chrome']);
      expect(res.notifiedUpdateIds).toEqual(['upd1']);
    });

    it('keeps notify and auto_update policies notifying', async () => {
      const calls = { markNotified: [] as string[][], histInserts: [] as string[] };
      const supabase = makeSupabase({
        notification_preferences: prefs,
        webhook_configurations: webhooks,
        user_profiles: profile,
        app_update_policies: [policy('Notify.App', 'notify'), policy('Auto.App', 'auto_update')],
      }, calls);

      const res = await notifyUserOfPendingUpdates(supabase, 'u1', {
        pendingUpdates: [row('upd5', 'Notify.App', '2.0'), row('upd6', 'Auto.App', '2.0')] as any,
      });

      expect(notifiedApps()).toEqual(['Auto.App', 'Notify.App']);
      expect(res.notifiedUpdateIds.sort()).toEqual(['upd5', 'upd6']);
    });

    it('does not mark an ignored row notified when the critical-only filter removes everything', async () => {
      const calls = { markNotified: [] as string[][], histInserts: [] as string[] };
      const supabase = makeSupabase({
        notification_preferences: { ...prefs, notify_critical_only: true },
        webhook_configurations: webhooks,
        user_profiles: profile,
        app_update_policies: [policy('Ignored.App', 'ignore')],
      }, calls);

      const res = await notifyUserOfPendingUpdates(supabase, 'u1', {
        pendingUpdates: [row('upd1', 'Google.Chrome', '2.0'), row('upd2', 'Ignored.App', '2.0')] as any,
      });

      expect(sendEmailMock).not.toHaveBeenCalled();
      expect(res.notifiedUpdateIds).toEqual(['upd1']);
      expect(calls.markNotified.flat()).not.toContain('upd2');
    });

    it('sends nothing and marks nothing when the policies cannot be loaded', async () => {
      const calls = { markNotified: [] as string[][], histInserts: [] as string[] };
      const supabase = makeSupabase({
        notification_preferences: prefs,
        webhook_configurations: webhooks,
        user_profiles: profile,
      }, calls, { app_update_policies: 'db down' });

      const res = await notifyUserOfPendingUpdates(supabase, 'u1', {
        pendingUpdates: [row('upd1', 'Google.Chrome', '2.0')] as any,
      });

      expect(sendEmailMock).not.toHaveBeenCalled();
      expect(deliverWebhookMock).not.toHaveBeenCalled();
      expect(calls.markNotified.flat()).toEqual([]);
      expect(res.errors).toEqual(['Error fetching update policies: db down']);
    });
  });
});
