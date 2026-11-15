import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SupabaseCatalogSource } from './supabase-source';
import type { ReleaseHistoryFilters } from './release-history';
const shared = vi.hoisted(() => ({ value: null as unknown, at: 0 }));
vi.mock('next/cache', () => ({ unstable_cache: (load: () => Promise<unknown>) => async () => {
  if (shared.value && Date.now() - shared.at < 300_000) return shared.value;
  const value = await load(); shared.value = value; shared.at = Date.now(); return value;
} }));

const filters: ReleaseHistoryFilters = { query: '', month: '', kind: 'all', page: 1 };
const summary = { rows: [], total: 100000, apps: 9000, firstTracked: 9000, months: ['2026-11'], coverageStart: '2026-01-01', sync: null };
let fetchMock: ReturnType<typeof vi.fn>;
let now: number;
beforeEach(() => {
  now = 1000; shared.value = null; shared.at = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://catalog.example.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon-key');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fetchMock = vi.fn(async (input: string | URL | Request) => Response.json(
    String(input).includes('get_catalog_release_history_global_rows') ? [] : summary,
  ));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const lastUrl = () => String(fetchMock.mock.calls.at(-1)![0]);

it('reuses a global summary for the observed deep page with the existing RPC transport', async () => {
  const source = new SupabaseCatalogSource();
  await source.getReleaseHistory(filters);
  await expect(source.getReleaseHistory({ ...filters, page: 1813 })).resolves.toEqual(summary);
  expect(lastUrl()).toContain('/rpc/get_catalog_release_history_global_rows');
  const init = fetchMock.mock.calls.at(-1)![1] as RequestInit;
  expect(JSON.parse(String(init.body))).toEqual({ page_number: 1813 });
  expect(new Headers(init.headers).get('apikey')).toBe('synthetic-service-key');
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

it.each([{ app: 'Fixture.App' }, { query: 'fixture' }, { month: '2026-11' },
  { kind: 'updated' as const }, { from: '2026-11-01' }, { to: '2026-11-10' }, { architecture: 'x64' }])(
  'keeps app and filtered requests on v2: %j', async extra => {
    const source = new SupabaseCatalogSource();
    await source.getReleaseHistory(filters);
    await source.getReleaseHistory({ ...filters, page: 2, ...extra });
    expect(lastUrl()).toContain('/rpc/get_catalog_release_history_v2');
  },
);
it('loads a shared summary on a cold instance and preserves the anon path', async () => {
  const source = new SupabaseCatalogSource();
  await source.getReleaseHistory({ ...filters, page: 2 });
  expect(lastUrl()).toContain('/rpc/get_catalog_release_history_global_rows');
  expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/get_catalog_release_history_v2'))).toHaveLength(1);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  await source.getReleaseHistory({ ...filters, page: 3 });
  expect(lastUrl()).toContain('/rpc/get_catalog_release_history_v2');
});
it('warms from a later page but does not extend summary freshness on rows-only reads', async () => {
  const source = new SupabaseCatalogSource();
  await source.getReleaseHistory({ ...filters, page: 2 });
  now += 299999;
  await source.getReleaseHistory({ ...filters, page: 3 });
  expect(lastUrl()).toContain('/rpc/get_catalog_release_history_global_rows');
  now += 1;
  await source.getReleaseHistory({ ...filters, page: 4 });
  expect(lastUrl()).toContain('/rpc/get_catalog_release_history_global_rows');
  expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/get_catalog_release_history_v2'))).toHaveLength(2);
});
it('rejects malformed rows and RPC errors without replacing the summary', async () => {
  const source = new SupabaseCatalogSource();
  await source.getReleaseHistory(filters);
  fetchMock.mockImplementationOnce(async () => Response.json({ unexpected: true }));
  await expect(source.getReleaseHistory({ ...filters, page: 2 })).rejects.toThrow('Catalog history unavailable');
  fetchMock.mockImplementationOnce(async () => Response.json({ message: 'synthetic', code: '57014' }, { status: 500 }));
  await expect(source.getReleaseHistory({ ...filters, page: 2 })).rejects.toThrow('Catalog history unavailable');
  await expect(source.getReleaseHistory({ ...filters, page: 2 })).resolves.toEqual(summary);
  expect(lastUrl()).toContain('/rpc/get_catalog_release_history_global_rows');
});

it('does not overwrite a fresh pagination total when an older rows response settles', async () => {
  const source = new SupabaseCatalogSource();
  fetchMock.mockImplementationOnce(async () => Response.json({ ...summary, total: 80 }));
  await source.getReleaseHistory(filters);
  let release!: (r: Response) => void;
  let started!: () => void;
  const began = new Promise<void>(r => { started = r; });
  fetchMock.mockImplementationOnce(async () => { started(); return new Promise<Response>(r => { release = r; }); });
  const pending = source.getReleaseHistory({ ...filters, page: 2 });
  await began;
  fetchMock.mockImplementationOnce(async () => Response.json({ ...summary, total: 120 }));
  await source.countReleaseHistory(filters);
  release(Response.json([]));
  await pending;
  await source.getReleaseHistory({ ...filters, page: 3 });
  expect(JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body)).page_number).toBe(3);
});
