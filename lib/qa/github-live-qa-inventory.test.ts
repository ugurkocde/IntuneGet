import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLiveQaInventory, readLiveQaInventoryFromGitHub } from './github-live-qa-inventory';

const config = { token: 'test-token-never-log', owner: 'test owner', workflowsRepo: 'workflow repo',
  workflowFile: 'package-intunewin.yml', ref: 'unrelated-branch' };
const empty = { total_count: 0, workflow_runs: [] };
const response = (status = 200, text = JSON.stringify(empty)) => {
  const value = new Response(status === 304 ? null : text, { status });
  const getReader = vi.spyOn(value.body ?? new ReadableStream(), 'getReader');
  return Object.assign(value, { getReader });
};
const pending = <T>() => new Promise<T>(() => {});
const read = (fetchImpl: typeof fetch) => readLiveQaInventoryFromGitHub({ config, fetchImpl });

describe('fixed QA GitHub inventory HTTP adapter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('reads exactly the five live statuses twice using only the fixed query and GET', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    expect(await read(fetchImpl)).toEqual({ state: 'complete', inventory: empty });
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(fetchImpl.mock.calls.map(([input]) => new URL(String(input)).searchParams.get('status')))
      .toEqual(['queued', 'waiting', 'pending', 'requested', 'in_progress',
        'queued', 'waiting', 'pending', 'requested', 'in_progress']);
    for (const [input, init] of fetchImpl.mock.calls) {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://api.github.com');
      expect(url.pathname).toBe('/repos/test%20owner/workflow%20repo/actions/workflows/intune-qa.yml/runs');
      expect([...url.searchParams.keys()]).toEqual(['status', 'per_page', 'page']);
      expect(url.searchParams.get('per_page')).toBe('100');
      expect(url.searchParams.get('page')).toBe('1');
      expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('collects a complete second page without adding other filters', async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, status: 'queued', path: '.github/workflows/intune-qa.yml' }));
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const q = new URL(String(input)).searchParams;
      return response(200, JSON.stringify(q.get('status') === 'queued'
        ? { total_count: 101, workflow_runs: items.slice((Number(q.get('page')) - 1) * 100, Number(q.get('page')) * 100) }
        : empty));
    });
    expect(await read(fetchImpl)).toEqual({ state: 'complete', inventory: { total_count: 101, workflow_runs: items } });
    expect(fetchImpl).toHaveBeenCalledTimes(12);
  });

  it('ends a noncooperative hanging fetch after five seconds without retry', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => pending<Response>());
    const result = read(fetchImpl);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toEqual({ state: 'unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends a hanging response body under the same request deadline', async () => {
    const bodyRead = vi.fn(() => pending<ReadableStreamReadResult<Uint8Array>>());
    const cancel = vi.fn(() => pending<void>());
    const reader = { read: bodyRead, cancel, releaseLock: vi.fn() };
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ status: 200, body: { getReader: () => reader } }) as unknown as Response);
    const result = read(fetchImpl);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toEqual({ state: 'unknown' });
    expect(bodyRead).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('limits the whole sequential inventory to fifteen seconds and stops new requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(resolve => setTimeout(() => resolve(response()), 4_900)));
    const result = read(fetchImpl);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toEqual({ state: 'unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards late fetch completion without reading its body', async () => {
    const late = response();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(resolve => setTimeout(() => resolve(late), 20_000)));
    const result = read(fetchImpl);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toEqual({ state: 'unknown' });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(late.getReader).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([304, 401, 403, 404, 429, 500])('does not read or retry HTTP %i bodies', async status => {
    const failed = response(status, config.token);
    const fetchImpl = vi.fn<typeof fetch>(async () => failed);
    expect(await read(fetchImpl)).toEqual({ state: 'unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(failed.getReader).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['not json', ' '.repeat(4 * 1024 * 1024 + 1), JSON.stringify({ total_count: 1, workflow_runs: [] })])
    ('rejects invalid or oversized response data', async body => {
      const fetchImpl = vi.fn<typeof fetch>(async () => response(200, body));
      expect(await read(fetchImpl)).toEqual({ state: 'unknown' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

  it('stops a multichunk oversized body before EOF and cancels without waiting', async () => {
    const bodyRead = vi.fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(2 * 1024 * 1024).fill(32) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(2 * 1024 * 1024 + 1).fill(32) })
      .mockImplementation(() => pending<ReadableStreamReadResult<Uint8Array>>());
    const cancel = vi.fn(() => pending<void>());
    const reader = { read: bodyRead, cancel, releaseLock: vi.fn() };
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ status: 200, body: { getReader: () => reader } }) as unknown as Response);
    expect(await read(fetchImpl)).toEqual({ state: 'unknown' });
    expect(bodyRead).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps UTF-8 bytes even when the decoded character count would fit', async () => {
    const body = JSON.stringify({ ...empty, padding: '€'.repeat(1_400_000) });
    expect(body.length).toBeLessThan(4 * 1024 * 1024);
    const fetchImpl = vi.fn<typeof fetch>(async () => response(200, body));
    expect(await read(fetchImpl)).toEqual({ state: 'unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid JSON body exactly at the byte limit', async () => {
    const json = JSON.stringify(empty);
    const body = json + ' '.repeat(4 * 1024 * 1024 - json.length);
    const fetchImpl = vi.fn<typeof fetch>(async () => response(200, body));
    expect(await read(fetchImpl)).toEqual({ state: 'complete', inventory: empty });
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('decodes a UTF-8 code point split between stream chunks', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ ...empty, padding: '€' }));
    const split = bytes.indexOf(0xe2) + 1;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    })));
    expect(await read(fetchImpl)).toEqual({ state: 'complete', inventory: empty });
  });

  it('fails closed on invalid UTF-8 and a missing stream', async () => {
    const malformed = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([0xff])));
    expect(await read(malformed)).toEqual({ state: 'unknown' });
    const missing = vi.fn<typeof fetch>(async () => new Response(null));
    expect(await read(missing)).toEqual({ state: 'unknown' });
  });

  it('returns only unknown and never logs transport errors containing a token', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error(config.token); });
    expect(await read(fetchImpl)).toEqual({ state: 'unknown' });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it('catches missing production credentials before fetching', async () => {
    vi.stubEnv('GITHUB_PAT', '');
    const fetchImpl = vi.spyOn(globalThis, 'fetch');
    expect(await readLiveQaInventory()).toEqual({ state: 'unknown' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects empty configuration and deadline widening without requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    expect(await readLiveQaInventoryFromGitHub({ config: { ...config, owner: '' }, fetchImpl })).toEqual({ state: 'unknown' });
    expect(await readLiveQaInventoryFromGitHub({ config, fetchImpl, requestMs: 5_001 })).toEqual({ state: 'unknown' });
    expect(await readLiveQaInventoryFromGitHub({ config, fetchImpl, overallMs: 15_001 })).toEqual({ state: 'unknown' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
