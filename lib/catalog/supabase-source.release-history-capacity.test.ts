import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseCatalogSource } from './supabase-source';
import type { ReleaseHistoryFilters } from './release-history';
import { knownLastHistoryPage, rememberHistoryTotal, withHistoryCapacity } from './release-history-capacity';
const filters: ReleaseHistoryFilters = { query: '', month: '', kind: 'all', page: 1 };
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://catalog.example.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-key');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const response = () => Response.json({ rows: [], total: 8 });
describe('history capacity across distinct keys', () => {
  it('rejects excess admission with the same error signature and a truthful warning', async () => {
    const gate = deferred();
    const work = vi.fn(() => gate.promise);
    const active = Array.from({length: 4}, () => withHistoryCapacity(work));
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(4));
    const queued = Array.from({length: 8}, () => withHistoryCapacity(work));
    const excess = withHistoryCapacity(work);
    await expect(excess).rejects.toThrow('Catalog history unavailable');
    expect(console.warn).toHaveBeenCalledWith('Catalog history RPC timing', expect.objectContaining({admission: 'rejected', category: 'error'}));
    gate.resolve(); await Promise.all([...active, ...queued]);
    expect(work).toHaveBeenCalledTimes(12);
  });
  it('expires queued admission without releasing occupied work or running the expired loader', async () => {
    vi.useFakeTimers();
    try {
      const gate = deferred();
      const active = Array.from({length: 4}, () => withHistoryCapacity(() => gate.promise));
      await Promise.resolve();
      const work = vi.fn(async () => undefined);
      const queued = withHistoryCapacity(work);
      const rejection = expect(queued).rejects.toThrow('Catalog history unavailable');
      await vi.advanceTimersByTimeAsync(5_000);
      await rejection;
      expect(work).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith('Catalog history RPC timing', expect.objectContaining({admission: 'wait_timeout', category: 'error'}));
      gate.resolve(); await Promise.all(active);
      await withHistoryCapacity(work);
      expect(work).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('does not reuse expired totals or totals for another filter', () => {
    const scoped = {...filters, app: 'Fixture.Expired'};
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    rememberHistoryTotal(scoped, 81);
    expect(knownLastHistoryPage(scoped)).toBe(3);
    expect(knownLastHistoryPage({...scoped, query: 'another'})).toBeNull();
    vi.mocked(Date.now).mockReturnValue(301_000);
    expect(knownLastHistoryPage(scoped)).toBeNull();
  });
  it('keeps both cache callback definitions and their keys identical to the deployed versions', async () => {
    const {readFileSync} = await import('node:fs');
    const page = readFileSync(new URL('../../app/(marketing)/apps/releases/page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(page).toContain(`const loadHistory = unstable_cache(
  async (filters: ReleaseHistoryFilters) =>
    requireCompleteHistory(await getCatalogSource().getReleaseHistory(filters)),
  ["catalog-release-history-v8"],
  { revalidate: 300 },
);`);
    expect(page).toContain(`const loadRecentUpdates = unstable_cache(
  (from: string) => getCatalogSource().countReleaseHistory({ query: "", month: "", kind: "updated", page: 1, from }),
  ["catalog-release-history-recent-v1"],
  { revalidate: 300 },
);`);
  });

  it('clamps an impossible page to the last page from a successful recent total', async () => {
    const fetch = vi.fn(async (_input: unknown, _init?: RequestInit) => Response.json({ rows: [], total: 81 }));
    vi.stubGlobal('fetch', fetch);
    const source = new SupabaseCatalogSource();
    const scoped = { ...filters, app: 'Fixture.Pagination' };
    await source.countReleaseHistory(scoped);
    await source.getReleaseHistory({ ...scoped, page: 50 });
    expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string).page_number).toBe(3);
  });

  it('limits all keys and both methods across source instances to four active reads', async () => {
    const gate = deferred(); let active = 0; let peak = 0;
    const fetch = vi.fn(async () => {
      active++; peak = Math.max(peak, active);
      try { await gate.promise; return response(); } finally { active--; }
    });
    vi.stubGlobal('fetch', fetch);
    const sources = [new SupabaseCatalogSource(), new SupabaseCatalogSource()];
    const reads = Array.from({ length: 46 }, (_, i) => sources[i % 2][i % 3 ? 'getReleaseHistory' : 'countReleaseHistory']({ ...filters, app: `Fixture.App${i}` }));
    const settled = Promise.allSettled(reads);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    const admitted = fetch.mock.calls.length;
    gate.resolve(); const results = await settled;
    expect(admitted).toBe(4);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(12);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(34);
    for (const result of results) if (result.status === 'rejected') expect(result.reason.message).toBe('Catalog history unavailable');
    expect(admitted).toBe(4); expect(peak).toBe(4);
  });
  it('keeps abandoned callers occupying their slots until the underlying work settles', async () => {
    const gate = deferred();
    const fetch = vi.fn(async () => { await gate.promise; return response(); });
    vi.stubGlobal('fetch', fetch);
    const source = new SupabaseCatalogSource();
    const reads = Array.from({length: 4}, (_, i) => source.countReleaseHistory({ ...filters, app: `Fixture.Busy${i}` }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    await Promise.race([reads[0], Promise.resolve('caller left')]);
    const next = new SupabaseCatalogSource().countReleaseHistory({ ...filters, app: 'Fixture.Next' });
    await new Promise(resolve => setTimeout(resolve, 20));
    const beforeSettle = fetch.mock.calls.length;
    gate.resolve(); await Promise.all([...reads, next]);
    expect(beforeSettle).toBe(4); expect(fetch).toHaveBeenCalledTimes(5);
  });
});
