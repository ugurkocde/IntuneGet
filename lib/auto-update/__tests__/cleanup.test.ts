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
