import { afterEach, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => vi.fn());
vi.mock('./history-transport', () => ({ isolatedHistoryFetch: transport }));
import { SupabaseCatalogSource } from './supabase-source';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); transport.mockReset(); });
it('opts in only the read-only v2 RPC under the existing shared deadline', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service');
  transport.mockImplementation(async (input: unknown) => Response.json(String(input).endsWith('get_catalog_recent_update_count') ? 12
    : String(input).endsWith('get_catalog_release_history_global_rows') ? [] : { rows: [], total: 1000 }));
  const source = new SupabaseCatalogSource();
  const filters = { query: '', month: '', kind: 'all' as const, page: 1 };
  await source.countReleaseHistory(filters);
  await source.countReleaseHistory({ ...filters, page: 2 });
  await source.countReleaseHistory({ ...filters, kind: 'updated', from: '2026-11-01' });
  expect(transport.mock.calls.map(call => call[3])).toEqual([true, false, false]);
  expect(transport.mock.calls.every(call => call[1].signal instanceof AbortSignal)).toBe(true);
});
