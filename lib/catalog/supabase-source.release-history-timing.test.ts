import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseCatalogSource } from './supabase-source';
import type { ReleaseHistoryFilters } from './release-history';

const filters = { app: 'Private.Filter', query: '', month: '', kind: '', page: 1 } as ReleaseHistoryFilters;
const result = { rows: [], total: 7 };
let clock: number;
let controller: AbortController;
let warn: ReturnType<typeof vi.spyOn>;
let fetchMock: ReturnType<typeof vi.fn>;
let timer: ReturnType<typeof vi.spyOn>;
const timeout = () => { clock = 15_001; controller.abort(new DOMException('Private abort text', 'TimeoutError')); };

beforeEach(() => {
  clock = 0;
  controller = new AbortController();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://private-catalog.example.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'private-service-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'private-anon-key');
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  timer = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => controller.signal);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function check(category: string, budgetExpired: boolean, status: number | null, headers: boolean) {
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toBe('Catalog history RPC timing');
  const timing = warn.mock.calls[0][1];
  expect(timing).toEqual({ entryMs: 0, dispatchMs: expect.any(Number), headersMs: headers ? expect.any(Number) : null,
    settledMs: expect.any(Number), category, budgetExpired, status,
    filterShape: { app: true, query: false, month: false, from: false, to: false, architecture: false, kind: 'other', laterPage: false } });
  expect(timing.dispatchMs).toBeGreaterThanOrEqual(0);
  expect(timing.settledMs).toBeGreaterThanOrEqual(timing.dispatchMs);
  if (headers) expect(timing.headersMs).toBeLessThanOrEqual(timing.settledMs);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [input, init] = fetchMock.mock.calls[0];
  expect(String(input)).toContain('/rest/v1/rpc/get_catalog_release_history_v2');
  expect(init.method).toBe('POST');
  expect(new Headers(init.headers).get('apikey')).toBe('private-service-key');
  expect(init.signal).toBe(controller.signal);
  expect(timer).toHaveBeenCalledWith(15_000);
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|https|apikey|authorization|cause|url/i);
}
const run = () => new SupabaseCatalogSource().countReleaseHistory(filters);

describe('release history RPC diagnostics', () => {
  it('reports slow success without changing its result', async () => {
    fetchMock.mockImplementation(async () => { clock = 6001; return Response.json(result); });
    await expect(run()).resolves.toBe(7);
    check('success', false, 200, true);
  });
  it('records a late dispatch with an already aborted signal', async () => {
    timer.mockImplementation(() => { timeout(); return controller.signal; });
    fetchMock.mockImplementation(async () => { throw controller.signal.reason; });
    await expect(run()).rejects.toThrow('Catalog history unavailable');
    check('error', true, null, false);
    expect(warn.mock.calls[0][1].dispatchMs).toBe(15_001);
  });
  it('reports a timeout while waiting for response headers', async () => {
    fetchMock.mockImplementation(async () => { timeout(); throw controller.signal.reason; });
    await expect(run()).rejects.toThrow('Catalog history unavailable');
    check('error', true, null, false);
  });
  it('retains header status when the SDK body read aborts', async () => {
    fetchMock.mockImplementation(async () => {
      clock = 3;
      const body = new ReadableStream({ start(stream) {
        controller.signal.addEventListener('abort', () => stream.error(controller.signal.reason), { once: true });
        setTimeout(timeout, 0);
      } });
      return new Response(body, { status: 200 });
    });
    await expect(run()).rejects.toThrow('Catalog history unavailable');
    check('error', true, 200, true);
    expect(warn.mock.calls[0][1].headersMs).toBe(3);
  });
  it('keeps an unrelated failure distinct from the expired budget and preserves its cause', async () => {
    fetchMock.mockImplementation(async () => { timeout(); throw new Error('Private transport detail'); });
    const error = await run().catch(error => error);
    expect(error.message).toBe('Catalog history unavailable');
    expect(error.cause).toBeDefined();
    check('error', true, null, false);
  });
  it('reports an unrelated HTTP error without exposing its content', async () => {
    fetchMock.mockResolvedValue(Response.json({ message: 'Private failure body', code: 'fixture' }, { status: 500 }));
    await expect(run()).rejects.toThrow('Catalog history unavailable');
    check('error', false, 500, true);
    expect(controller.signal.aborted).toBe(false);
  });
  it('does not log fast successful requests', async () => {
    fetchMock.mockResolvedValue(Response.json(result));
    await expect(run()).resolves.toBe(7);
    expect(warn).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reports only the filter shape on failures, never filter values', async () => {
    fetchMock.mockResolvedValue(Response.json({ message: 'Private failure body' }, { status: 500 }));
    const privateFilters: ReleaseHistoryFilters = {
      app: 'Private.Application', query: 'Private.Search', month: '2044-03',
      from: '2044-03-01', to: '2044-03-21', architecture: 'arm64', kind: 'updated', page: 9876,
    };
    await expect(new SupabaseCatalogSource().countReleaseHistory(privateFilters)).rejects.toThrow('Catalog history unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1].filterShape).toEqual({
      app: true, query: true, month: true, from: true, to: true, architecture: true,
      kind: 'updated', laterPage: true,
    });
    const logged = JSON.stringify(warn.mock.calls);
    for (const value of ['Private.Application', 'Private.Search', '2044-03', '2044-03-01', '2044-03-21', 'arm64', '9876']) {
      expect(logged).not.toContain(value);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not expose an unsupported runtime kind as a diagnostic value', async () => {
    fetchMock.mockResolvedValue(Response.json({ message: 'Private failure body' }, { status: 500 }));
    await expect(new SupabaseCatalogSource().countReleaseHistory({ ...filters, kind: 'Private.Kind' } as unknown as ReleaseHistoryFilters))
      .rejects.toThrow('Catalog history unavailable');
    expect(warn.mock.calls[0][1].filterShape?.kind).toBe('other');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Private.Kind');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('keeps a successful request silent at the five second boundary', async () => {
    fetchMock.mockImplementation(async () => { clock = 5000; return Response.json(result); });
    await expect(run()).resolves.toBe(7);
    expect(warn).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
