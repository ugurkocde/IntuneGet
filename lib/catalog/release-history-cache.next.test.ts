import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { withHistoryCapacity } from './release-history-capacity';
// Next initializes these stores from the server runtime global.
Object.assign(globalThis, { AsyncLocalStorage });
const { unstable_cache } = await import('next/cache');
const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['rejected', 'wait_timeout'] as const)('keeps the actual Next stale value and no-cache error on %s', async admission => {
  if (admission === 'wait_timeout') vi.useFakeTimers();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const active = Array.from({length: 4}, () => withHistoryCapacity(() => gate));
  await Promise.resolve();
  const queued = Array.from({length: admission === 'rejected' ? 8 : 0}, () => withHistoryCapacity(() => gate));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  let cold = false;
  const lastGood = { rows: ['fixture'], total: 1 };
  const cache = { generateSimpleCacheKey: async (key: string) => key,
    get: vi.fn(async () => cold ? null : ({ isStale: true, value: { kind: 'FETCH', data: { body: JSON.stringify(lastGood) } } })),
    set: vi.fn(async () => {}) };
  vi.stubGlobal('__incrementalCache', cache);
  const callback = unstable_cache(() => withHistoryCapacity(async () => ({ rows: [], total: 0 })), ['fixture-history'], {revalidate: 300});
  const store = { nextFetchId: 1, route: '/apps/releases', pendingRevalidates: {}, isStaticGeneration: false };
  try {
    const stale = await workAsyncStorage.run(store as never, () => callback());
    expect(stale).toEqual(lastGood);
    if (admission === 'wait_timeout') await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all(Object.values(store.pendingRevalidates));
    expect(cache.set).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('revalidating cache'), expect.objectContaining({message: 'Catalog history unavailable'}));
    expect(warn).toHaveBeenCalledWith('Catalog history RPC timing', expect.objectContaining({admission}));
    cold = true;
    const rejected = expect(workAsyncStorage.run({...store, pendingRevalidates: {}} as never, () => callback())).rejects.toThrow('Catalog history unavailable');
    if (admission === 'wait_timeout') await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(cache.set).not.toHaveBeenCalled();
  } finally { release(); await Promise.all([...active, ...queued]); vi.useRealTimers(); }
});
