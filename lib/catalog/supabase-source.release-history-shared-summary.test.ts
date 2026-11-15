import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
Object.assign(globalThis, { AsyncLocalStorage });
const { SupabaseCatalogSource } = await import('./supabase-source');
const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
const filters = { query: '', month: '', kind: 'all' as const, page: 2 };
const summary = { total: 800, apps: 10, firstTracked: 10, months: ['2026-11'], coverageStart: '2026-01-01', sync: null };
let stale = false;
let cached = true;
let fetchMock: ReturnType<typeof vi.fn>;
let cacheSet: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stale = false; cached = true;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://catalog.example.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  cacheSet = vi.fn(async () => {});
  vi.stubGlobal('__incrementalCache', {
    generateSimpleCacheKey: async (key: string) => key,
    get: vi.fn(async () => cached ? ({ isStale: stale, value: { kind: 'FETCH', data: { body: JSON.stringify(summary) } } }) : null),
    set: cacheSet,
  });
  fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => String(input).includes('global_rows')
    ? Response.json([])
    : Response.json({ code: '57014', message: 'Synthetic statement timeout' }, { status: 500 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function read(page = 2) {
  const store = { nextFetchId: 1, route: '/apps/releases', pendingRevalidates: {}, isStaticGeneration: false };
  const result = await workAsyncStorage.run(store as never, () => new SupabaseCatalogSource().getReleaseHistory({ ...filters, page }));
  await Promise.all(Object.values(store.pendingRevalidates));
  return result;
}
it.each([1, 2])('uses a summary cached by another instance for global page %s', async page => {
  await expect(read(page)).resolves.toEqual({ ...summary, rows: [] });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toContain('/rpc/get_catalog_release_history_global_rows');
  expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ page_number: page });
});
it('keeps stale summary and rows available when the real Next refresh gets an SDK 57014', async () => {
  stale = true;
  const row = { winget_id: 'Fixture.App', name: 'Fixture App', publisher: null, version: '2', previous_version: '1', detected_at: '2026-11-01T00:00:00Z', release_date: null };
  fetchMock.mockImplementation(async (input: unknown) => String(input).includes('global_rows')
    ? Response.json([row]) : String(input).includes('/version_history')
      ? Response.json([{ winget_id: row.winget_id, version: row.version, installers: [], release_notes_url: null, installer_sha256: null }])
      : Response.json({ code: '57014', message: 'Synthetic statement timeout' }, { status: 500 }));
  const result = await read();
  expect(result).toMatchObject({ ...summary, rows: [row] });
  expect(result.rows[0].detailsUnavailable).not.toBe(true);
  expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/get_catalog_release_history_v2'))).toHaveLength(1);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('revalidating cache'), expect.objectContaining({ message: 'Catalog history unavailable' }));
  expect(cacheSet).not.toHaveBeenCalled();
});
it('coalesces a cold summary RPC across concurrent source instances without nesting capacity slots', async () => {
  cached = false;
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>(done => { resolve = done; });
  fetchMock.mockImplementation(async (input: unknown) => String(input).includes('global_rows') ? Response.json([]) : (await pending).clone());
  const reads = [read(1), read(2)];
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  resolve(Response.json({ ...summary, rows: [] }));
  await expect(Promise.all(reads)).resolves.toHaveLength(2);
  expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/get_catalog_release_history_v2'))).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/get_catalog_release_history_global_rows'))).toHaveLength(2);
});
it('fails a cold summary error without caching an empty success', async () => {
  cached = false;
  await expect(read()).rejects.toThrow('Catalog history unavailable');
  expect(cacheSet).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
