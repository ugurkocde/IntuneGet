import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAutoUpdateJobCompletion } from '../cleanup';
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
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
