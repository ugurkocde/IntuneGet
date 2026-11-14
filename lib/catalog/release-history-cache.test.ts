import { describe, it, expect, vi } from 'vitest';
import { CompleteHistoryError, requireCompleteHistory, loadCompleteHistory, countRecentUpdates } from './release-history-cache';
import type { ReleaseHistoryFilters, ReleaseHistoryResult } from './release-history';
const result: ReleaseHistoryResult = {rows:[{winget_id:'Example.App',name:'Example',publisher:null,version:'1',previous_version:null,detected_at:'2026-09-11',release_date:null}],total:1,apps:1,firstTracked:1,months:[],coverageStart:null,sync:null};
describe('release history cache admission', () => {
  it('allows complete records even when a vendor provides no optional metadata', () => {
    expect(requireCompleteHistory(result)).toBe(result);
  });
  it('rejects transiently incomplete results but preserves the records for rendering', () => {
    const partial = {...result, rows:result.rows.map(row=>({...row,detailsUnavailable:true}))};
    expect(() => requireCompleteHistory(partial)).toThrow(CompleteHistoryError);
    try { requireCompleteHistory(partial); } catch (error) {
      expect((error as CompleteHistoryError).result).toBe(partial);
    }
  });
});

const filters: ReleaseHistoryFilters = { query: '', month: '', kind: 'all', page: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe('history callback single flight within one server instance', () => {
  it('collapses eight concurrent history callbacks to one source call', async () => {
    const work = deferred<ReleaseHistoryResult>();
    const source = { getReleaseHistory: vi.fn(() => work.promise) };
    const calls = Array.from({ length: 8 }, () => loadCompleteHistory(source, { ...filters }));
    await Promise.resolve();
    const observed = source.getReleaseHistory.mock.calls.length;
    work.resolve(result);
    expect(await Promise.all(calls)).toEqual(Array(8).fill(result));
    expect(observed).toBe(1);
  });
  it('collapses eight recent count callbacks and keeps history and recent separate', async () => {
    const history = deferred<ReleaseHistoryResult>(), count = deferred<number>();
    const source = { getReleaseHistory: vi.fn(() => history.promise), countReleaseHistory: vi.fn(() => count.promise) };
    const calls = Array.from({ length: 8 }, () => countRecentUpdates(source, '2026-11-14'));
    const page = loadCompleteHistory(source, { ...filters, from: '2026-11-14' });
    await Promise.resolve();
    const observed = source.countReleaseHistory.mock.calls.length;
    count.resolve(7); history.resolve(result);
    expect(await Promise.all(calls)).toEqual(Array(8).fill(7)); await page;
    expect(observed).toBe(1); expect(source.getReleaseHistory).toHaveBeenCalledTimes(1);
    expect(source.countReleaseHistory).toHaveBeenCalledWith({ query: '', month: '', kind: 'updated', page: 1, from: '2026-11-14' });
  });
  it.each([
    { app: 'Example.App' }, { query: 'example' }, { month: '2026-11' }, { kind: 'first' as const },
    { from: '2026-11-01' }, { to: '2026-11-14' }, { architecture: 'x64' }, { page: 2 },
  ])('isolates filters %j', async (variation) => {
    const work = deferred<ReleaseHistoryResult>();
    const source = { getReleaseHistory: vi.fn(() => work.promise) };
    const calls = [loadCompleteHistory(source, filters), loadCompleteHistory(source, { ...filters, ...variation })];
    await Promise.resolve(); const observed = source.getReleaseHistory.mock.calls.length;
    work.resolve(result); await Promise.all(calls); expect(observed).toBe(2);
  });
  it('shares rejection without swallowing it, then allows a new attempt', async () => {
    const work = deferred<ReleaseHistoryResult>(), error = new Error('Synthetic RPC failure');
    const source = { getReleaseHistory: vi.fn(() => work.promise) };
    const calls = Array.from({ length: 8 }, () => loadCompleteHistory(source, filters));
    const settled = Promise.allSettled(calls); await Promise.resolve();
    const observed = source.getReleaseHistory.mock.calls.length;
    work.reject(error);
    for (const item of await settled) expect(item).toEqual({ status: 'rejected', reason: error });
    source.getReleaseHistory.mockResolvedValue(result);
    expect(await loadCompleteHistory(source, filters)).toBe(result);
    expect(observed).toBe(1); expect(source.getReleaseHistory).toHaveBeenCalledTimes(2);
  });
  it('retains the underlying flight when one caller abandons its wait', async () => {
    const work = deferred<ReleaseHistoryResult>();
    const source = { getReleaseHistory: vi.fn(() => work.promise) };
    const first = loadCompleteHistory(source, filters);
    expect(await Promise.race([first, Promise.resolve('caller abandoned')])).toBe('caller abandoned');
    const later = loadCompleteHistory(source, filters); await Promise.resolve();
    const observed = source.getReleaseHistory.mock.calls.length;
    work.resolve(result); await Promise.all([first, later]); expect(observed).toBe(1);
  });
  it('rejects every partial joiner and leaves the shared result untouched', async () => {
    const work = deferred<ReleaseHistoryResult>();
    const partial = { ...result, rows: result.rows.map(row => ({ ...row, detailsUnavailable: true })) };
    const before = JSON.stringify(partial), source = { getReleaseHistory: vi.fn(() => work.promise) };
    const settled = Promise.allSettled(Array.from({ length: 8 }, () => loadCompleteHistory(source, filters)));
    work.resolve(partial);
    for (const item of await settled) {
      expect(item.status).toBe('rejected');
      if (item.status === 'rejected') { expect(item.reason).toBeInstanceOf(CompleteHistoryError); expect(item.reason.result).toBe(partial); }
    }
    expect(JSON.stringify(partial)).toBe(before); expect(source.getReleaseHistory).toHaveBeenCalledTimes(1);
  });
  it('clears successful work so a later stale hit can refresh again', async () => {
    const source = { getReleaseHistory: vi.fn().mockResolvedValue(result) };
    await loadCompleteHistory(source, filters); await loadCompleteHistory(source, filters);
    expect(source.getReleaseHistory).toHaveBeenCalledTimes(2);
  });
  it('keeps recent date keys separate and retries rejected recent work', async () => {
    const work = deferred<number>(), source = { countReleaseHistory: vi.fn(() => work.promise) };
    const settled = Promise.allSettled([countRecentUpdates(source, '2026-11-13'), countRecentUpdates(source, '2026-11-14')]);
    await Promise.resolve(); expect(source.countReleaseHistory).toHaveBeenCalledTimes(2);
    work.reject(new Error('Synthetic count failure')); await settled;
    source.countReleaseHistory.mockResolvedValue(0); expect(await countRecentUpdates(source, '2026-11-13')).toBe(0);
    expect(source.countReleaseHistory).toHaveBeenCalledTimes(3);
  });
});
