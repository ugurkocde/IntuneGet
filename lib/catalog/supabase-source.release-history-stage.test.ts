import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseCatalogSource } from './supabase-source';
import type { ReleaseHistoryFilters } from './release-history';

// Diagnostics only: these tests prove what the stage summaries report, not why production requests fail.
const SECRETS = ['Secret.App.Sentinel', '9.8.7-secret', 'Secret.Query', 'secret-tenant', 'private-catalog',
  'private-service-key', 'private-anon-key', 'Private failure body'];
const filters = { app: 'Secret.App.Sentinel.A', query: 'Secret.Query', month: '', kind: 'all', page: 1 } as ReleaseHistoryFilters;
const row = (suffix: string) => ({ winget_id: `Secret.App.Sentinel.${suffix}`, version: '9.8.7-secret', name: 'secret-tenant' });
const rpcResult = { rows: [row('A'), row('B')], total: 2 };
let clock: number;
let timers: { ms: number; controller: AbortController }[];
let warn: ReturnType<typeof vi.spyOn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clock = 0;
  timers = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://private-catalog.example.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'private-service-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'private-anon-key');
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    const controller = new AbortController();
    timers.push({ ms, controller });
    return controller.signal;
  });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const fire = (ms: number, index = 0) => {
  const timer = timers.filter(entry => entry.ms === ms)[index];
  timer.controller.abort(new DOMException('Private abort text', 'TimeoutError'));
};
const logged = (message: string) => warn.mock.calls.filter(call => call[0] === message).map(call => call[1]);
const timerCounts = () => timers.reduce<Record<number, number>>((counts, { ms }) => ({ ...counts, [ms]: (counts[ms] ?? 0) + 1 }), {});
const expectPrivate = () => {
  const text = JSON.stringify(warn.mock.calls);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/https|apikey|authorization|version_history|winget_id|cause/i);
};
const rpcKeys = ['entryMs', 'dispatchMs', 'headersMs', 'settledMs', 'category', 'budgetExpired', 'status', 'filterShape',
  'inst', 'seq', 'rpc', 'startedAt', 'emittedAt', 'abortFiredMs', 'elu', 'wallMinusMonoMs', 'inflightAtStart', 'inflightAtSettle'];
const metadataKeys = ['inst', 'seq', 'rpcSettledMs', 'metadataMs', 'elu', 'firstBatchAbortLatenessMs', 'batchFailures',
  'singlesAttempted', 'singlesRecovered', 'recoveryExpired', 'unavailableRows'];

function metadataFailureFetch() {
  fetchMock.mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/rpc/')) { clock = 6000; return Response.json(rpcResult); }
    if (url.includes('or=')) {
      if (clock === 6000) { clock = 9250; fire(3000, 0); }
      return Response.json({ message: 'Private failure body' }, { status: 500 });
    }
    if (decodeURIComponent(url).includes('Sentinel.A')) return Response.json([{ ...row('A'), release_notes_url: null, installer_sha256: null, installers: null }]);
    return Response.json({ message: 'Private failure body' }, { status: 500 });
  });
}

describe('release history stage diagnostics', () => {
  it('pairs the RPC and metadata summaries with an exact private allowlist and counters', async () => {
    metadataFailureFetch();
    const result = await new SupabaseCatalogSource().getReleaseHistory(filters);
    expect(result.rows.filter(entry => 'detailsUnavailable' in entry)).toHaveLength(1);
    const [rpc] = logged('Catalog history RPC timing');
    const [metadata] = logged('Catalog history metadata timing');
    expect(Object.keys(rpc).sort()).toEqual([...rpcKeys].sort());
    expect(Object.keys(metadata).sort()).toEqual([...metadataKeys].sort());
    expect(rpc.inst).toMatch(/^[0-9a-f]{8}$/);
    expect(metadata.inst).toBe(rpc.inst);
    expect(metadata.seq).toBe(rpc.seq);
    expect(rpc).toMatchObject({ rpc: 'v2', category: 'success', settledMs: 6000, abortFiredMs: null, inflightAtStart: 0, inflightAtSettle: 0 });
    expect(rpc.emittedAt).toBeGreaterThanOrEqual(rpc.startedAt);
    expect(typeof rpc.wallMinusMonoMs).toBe('number');
    for (const elu of [rpc.elu, metadata.elu]) expect(elu === null || (typeof elu === 'number' && elu >= 0 && elu <= 1)).toBe(true);
    expect(metadata).toMatchObject({
      rpcSettledMs: 6000, metadataMs: 3250, firstBatchAbortLatenessMs: 250,
      batchFailures: { aborted: 0, http5xx: 2, statementTimeout: 0, other: 0 },
      singlesAttempted: 2, singlesRecovered: 1, recoveryExpired: false, unavailableRows: 1,
    });
    expectPrivate();
  });

  it('keeps the request and timeout budget counts unchanged', async () => {
    metadataFailureFetch();
    await new SupabaseCatalogSource().getReleaseHistory(filters);
    // One RPC, one batch plus its retry, two single-row recoveries. No reputation read without hashes.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(timerCounts()).toEqual({ 15000: 1, 3000: 4, 8000: 1 });
  });

  it('records when the existing fifteen second RPC budget fires', async () => {
    fetchMock.mockImplementation(async () => { clock = 15_250; fire(15_000); throw new DOMException('Private abort text', 'AbortError'); });
    await expect(new SupabaseCatalogSource().getReleaseHistory(filters)).rejects.toThrow('Catalog history unavailable');
    const [rpc] = logged('Catalog history RPC timing');
    expect(rpc).toMatchObject({ category: 'error', budgetExpired: true, abortFiredMs: 15_250, inflightAtStart: 0, inflightAtSettle: 0 });
    expect(logged('Catalog history metadata timing')).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(timerCounts()).toEqual({ 15000: 1 });
    expectPrivate();
  });

  it('keeps normalized status-zero failures ambiguous and reports expired recovery', async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/rpc/')) return Response.json(rpcResult);
      if (url.includes('or=')) throw new DOMException('Private abort text', 'AbortError');
      fire(8000);
      throw new DOMException('Private abort text', 'AbortError');
    });
    await new SupabaseCatalogSource().getReleaseHistory(filters);
    const [metadata] = logged('Catalog history metadata timing');
    expect(metadata).toMatchObject({ batchFailures: { aborted: 0, http5xx: 0, statementTimeout: 0, other: 1 },
      singlesAttempted: 2, singlesRecovered: 0, recoveryExpired: true, unavailableRows: 2, firstBatchAbortLatenessMs: null });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(timerCounts()).toEqual({ 15000: 1, 3000: 3, 8000: 1 });
    expectPrivate();
  });

  it('keeps fast complete metadata silent', async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => String(input).includes('/rpc/')
      ? Response.json(rpcResult)
      : Response.json([row('A'), row('B')].map(entry => ({ ...entry, release_notes_url: null, installer_sha256: null, installers: null }))));
    await new SupabaseCatalogSource().getReleaseHistory(filters);
    expect(warn).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('labels the count RPC and reports concurrent in-flight work', async () => {
    const releases: (() => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => {
      releases.push(() => resolve(Response.json({ message: 'Private failure body' }, { status: 500 })));
    }));
    const source = new SupabaseCatalogSource();
    const count = { query: '', month: '', kind: 'updated', from: '2044-01-01', page: 1 } as ReleaseHistoryFilters;
    const first = source.countReleaseHistory(count).catch(() => null);
    const second = source.countReleaseHistory({ ...count, from: '2044-02-02' }).catch(() => null);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]();
    await first;
    releases[1]();
    await second;
    const entries = logged('Catalog history RPC timing');
    expect(entries.map(entry => [entry.rpc, entry.inflightAtStart, entry.inflightAtSettle])).toEqual([['count', 0, 1], ['count', 1, 0]]);
    expect(entries[1].seq).toBeGreaterThan(entries[0].seq);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/2044/);
  });
});
