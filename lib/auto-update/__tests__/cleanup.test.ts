import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAutoUpdateJobCompletion } from '../cleanup';
const { from, notifyPaused } = vi.hoisted(() => ({ from: vi.fn(), notifyPaused: vi.fn() }));
vi.mock('@/lib/notification-service', () => ({ notifyAutoUpdatePaused: notifyPaused }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from }) }));
afterEach(() => vi.unstubAllEnvs());

describe('auto-update approval checkpoint retention', () => {
  it.each([
    ['approval', null, true], ['system', 'INTUNE_APPROVAL_REQUIRED', true], ['network', 'DOWNLOAD_FAILED', false],
  ])('dismisses %s failures without losing approval evidence', async (category, code, retained) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const updates: Array<{ table: string; value: Record<string, unknown> }> = [];
    const deletions: string[] = [];
    from.mockImplementation((table: string) => {
      const builder = {
        error: null, select: vi.fn().mockImplementation(() => builder), eq: vi.fn().mockImplementation(() => builder),
        single: vi.fn(async () => ({ data: table === 'packaging_jobs'
          ? { is_auto_update: true, auto_update_policy_id: 'policy', package_config: { autoUpdateHistoryId: 'history' },
              error_category: category, error_code: code }
          : table === 'auto_update_history' ? { status: 'pending' } : { consecutive_failures: 0 }, error: null })),
        update: vi.fn((value: Record<string, unknown>) => { updates.push({ table, value }); return builder; }),
        delete: vi.fn(() => { deletions.push(table); return builder; }),
      };
      return builder;
    });
    await handleAutoUpdateJobCompletion('job', 'failed');
    if (retained) {
      expect(updates).toContainEqual({ table: 'packaging_jobs', value: { archived_at: expect.any(String) } });
      expect(deletions).toEqual([]);
      expect(updates.some(u => u.table === 'msp_batch_deployment_items')).toBe(false);
    } else expect(deletions).toEqual(['packaging_jobs']);
  });
});


describe('completion failure tracking preserves manual policy choices', () => {
  it.each(['auto_update', 'notify', 'ignore', 'pin_version'] as const)('only disables automatic policies: %s', async policyType => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const updates: Array<{ table: string; value: Record<string, unknown> }> = [];
    from.mockImplementation((table: string) => {
      const builder = { error: null,
        select: vi.fn(() => builder), eq: vi.fn(() => builder), delete: vi.fn(() => builder),
        single: vi.fn(async () => ({ data: table === 'packaging_jobs'
          ? { is_auto_update: true, auto_update_policy_id: 'policy', package_config: { autoUpdateHistoryId: 'history' } }
          : table === 'auto_update_history' ? { status: 'pending' }
          : { consecutive_failures: 2, policy_type: policyType }, error: null })),
        update: vi.fn((value: Record<string, unknown>) => { updates.push({ table, value }); return builder; }),
      };
      return builder;
    });
    await handleAutoUpdateJobCompletion('job', 'failed', 'synthetic failure');
    const policyChange = updates.find(u => u.table === 'app_update_policies')!.value;
    expect(policyChange.consecutive_failures).toBe(3);
    if (policyType === 'auto_update') expect(policyChange.is_enabled).toBe(false);
    else expect(policyChange).not.toHaveProperty('is_enabled');
  });
});


describe('pause owner notices', () => {
  it.each([
    ['auto_update', true, 2, null, true], ['auto_update', false, 2, null, false],
    ['notify', true, 2, null, false], ['auto_update', true, 1, null, false],
    ['auto_update', true, 2, { message: 'fixture write failure' }, false],
  ] as const)('notifies only a successful enabled automatic transition: %s/%s/%s', async (policyType, enabled, failures, policyError, expected) => {
    notifyPaused.mockClear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-key');
    from.mockImplementation((table: string) => {
      const b = { error: table === 'app_update_policies' ? policyError : null,
        select: vi.fn(() => b), eq: vi.fn(() => b), delete: vi.fn(() => b), update: vi.fn(() => b),
        single: vi.fn(async () => ({ data: table === 'packaging_jobs' ? { is_auto_update: true, auto_update_policy_id: 'fixture-policy', package_config: { autoUpdateHistoryId: 'fixture-history' } } : table === 'auto_update_history' ? { status: 'pending' } : { consecutive_failures: failures, policy_type: policyType, is_enabled: enabled, user_id: 'fixture-owner', winget_id: 'Fixture.App', tenant_id: 'fixture-tenant' }, error: null })),
      }; return b;
    });
    await handleAutoUpdateJobCompletion('fixture-job', 'failed', 'Fixture failure');
    expect(notifyPaused).toHaveBeenCalledTimes(expected ? 1 : 0);
    if (expected) expect(notifyPaused).toHaveBeenCalledWith({ userId: 'fixture-owner', policyId: 'fixture-policy', wingetId: 'Fixture.App', tenantId: 'fixture-tenant', failures: 3, lastError: 'Fixture failure' });
  });
});
