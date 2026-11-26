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

it.each([
  [{ page: 100 }, true], [{ page: 101 }, false], [{ page: 1414 }, false],
  [{ page: 1414, app: 'Fixture.App' }, true], [{ page: 1414, query: 'fixture' }, true],
  [{ page: 1414, month: '2026-11' }, true], [{ page: 1414, kind: 'first' }, true],
  [{ page: 1414, from: '2026-11-01' }, true], [{ page: 1414, to: '2026-11-01' }, true],
  [{ page: 1414, architecture: 'x64' }, true],
] as const)('preserves recovery outside deep global reads: %j', async (extra, recover) => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service');
  transport.mockResolvedValue(Response.json({ rows: [], total: 100000 }));
  await new SupabaseCatalogSource().getReleaseHistory({ query: '', month: '', kind: 'all', page: 1, ...extra });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][3]).toBe(recover);
});
