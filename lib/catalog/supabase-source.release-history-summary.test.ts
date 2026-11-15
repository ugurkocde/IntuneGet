import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SupabaseCatalogSource } from './supabase-source';
import { rememberHistoryTotal } from './release-history-capacity';
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

it.each(['total', 'metadata'])('keeps overlapping page results bound to their own summary (%s)', async change => {
  const source = new SupabaseCatalogSource();
  const first = { ...summary, total: 80 };
  const second = change === 'total' ? { ...first, total: 120 }
    : { ...first, apps: 9100, months: ['2026-10', '2026-11'] };
  let release!: (response: Response) => void;
  let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  fetchMock.mockImplementationOnce(async () => {
    started();
    return new Promise<Response>(resolve => { release = resolve; });
  });
  const pending = source.getReleaseHistory({ ...filters, page: 2 }, first);
  await began;
  const overlapping = source.getReleaseHistory({ ...filters, page: 2 }, second);
  release(Response.json([]));
  expect(await pending).toEqual(first);
  expect(await overlapping).toEqual(second);
});

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

it('uses the refreshed shared total after an older rows response settles', async () => {
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
  await source.getReleaseHistory({ ...filters, page: 3 }, { ...summary, total: 120 });
  expect(JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body)).page_number).toBe(3);
});

it.each([true, false])('bounds global rows using the shared total instead of a stale local total (supplied=%s)', async supplied => {
  rememberHistoryTotal(filters, 80);
  const fresh = { ...summary, total: 120 };
  shared.value = fresh; shared.at = now;
  const source = new SupabaseCatalogSource();
  const result = await source.getReleaseHistory({ ...filters, page: 3 }, supplied ? fresh : undefined);
  expect(result.total).toBe(120);
  expect(JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body))).toEqual({ page_number: 3 });
});
it.each([80, 0])('caps global rows with a smaller shared total of %s', async total => {
  rememberHistoryTotal(filters, 120);
  const source = new SupabaseCatalogSource();
  const result = await source.getReleaseHistory({ ...filters, page: 3 }, { ...summary, total });
  expect(result.total).toBe(total);
  expect(JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body))).toEqual({ page_number: Math.max(1, Math.ceil(total / 40)) });
});
