import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseCatalogSource } from './supabase-source';
import type { ReleaseHistoryFilters } from './release-history';

const filters: ReleaseHistoryFilters = { query: '', month: '', kind: 'all', page: 1 };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://catalog.example.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fixture-anon');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
const response = (total = 7) => Response.json({ rows: [], total });

describe('concurrent release history source reads', () => {
  it.each(['getReleaseHistory', 'countReleaseHistory'] as const)(
    'shares pending %s reads for equivalent filters, then fetches after settling', async method => {
      const pending = deferred();
      fetchMock.mockImplementation(() => pending.promise.then(r => r.clone()));
      const source = new SupabaseCatalogSource();
      const first = source[method](filters);
      const second = source[method]({ page: 1, kind: 'all', month: '', query: '' });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const calls = fetchMock.mock.calls.length;
      pending.resolve(response());
      const results = await Promise.all([first, second]);
      expect(results[0]).toEqual(results[1]);
      expect(calls).toBe(1);
      fetchMock.mockImplementation(async () => response(9));
      const next = await source[method](filters);
      expect(typeof next === 'number' ? next : next.total).toBe(9);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  it('keeps different filters and methods independent', async () => {
    const pending = deferred();
    fetchMock.mockImplementation(() => pending.promise.then(r => r.clone()));
    const source = new SupabaseCatalogSource();
    const reads = [source.countReleaseHistory(filters),
      source.countReleaseHistory({ ...filters, app: 'Fixture.Other' }),
      source.getReleaseHistory(filters)];
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    pending.resolve(response());
    await Promise.all(reads);
  });
  it.each(['getReleaseHistory', 'countReleaseHistory'] as const)(
    'does not retain a rejected %s read', async method => {
      const pending = deferred();
      fetchMock.mockImplementation(() => pending.promise.then(r => r.clone()));
      const source = new SupabaseCatalogSource();
      const reads = [source[method](filters), source[method]({ ...filters })];
      const settled = Promise.allSettled(reads);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      pending.resolve(Response.json({ message: 'Synthetic failure', code: '57014' }, { status: 500 }));
      const results = await settled;
      for (const result of results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') expect(result.reason.message).toBe('Catalog history unavailable');
      }
      const calls = fetchMock.mock.calls.length;
      fetchMock.mockImplementation(async () => response());
      await source[method](filters);
      expect(fetchMock.mock.calls.length).toBe(calls + 1);
    });
  it('preserves unavailable metadata for both callers', async () => {
    const pending = deferred();
    const row = { winget_id: 'Fixture.App', version: '1.0', name: 'Fixture', publisher: null,
      previous_version: null, detected_at: '2026-01-01T00:00:00Z', release_date: null };
    fetchMock.mockImplementation((input: string | URL | Request) =>
      String(input).includes('/rpc/')
        ? pending.promise.then(r => r.clone())
        : Promise.resolve(Response.json({ message: 'Synthetic metadata failure' }, { status: 400 })));
    const source = new SupabaseCatalogSource();
    const reads = [source.getReleaseHistory(filters), source.getReleaseHistory({ ...filters })];
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    pending.resolve(Response.json({ rows: [row], total: 1 }));
    const results = await Promise.all(reads);
    for (const result of results) expect(result.rows).toEqual([{ ...row, detailsUnavailable: true }]);
  });
});
