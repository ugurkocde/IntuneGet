import { afterEach, describe, it, expect, vi } from 'vitest';
import { createHistoryCacheLoader, HISTORY_CACHE_SECONDS } from './release-history-cache';
import type { ReleaseHistoryResult } from './release-history';
const result: ReleaseHistoryResult = {rows:[{winget_id:'Example.App',name:'Example',publisher:null,version:'1',previous_version:null,detected_at:'2026-09-11',release_date:null}],total:1,apps:1,firstTracked:1,months:[],coverageStart:null,sync:null};
const filters = {query:'',month:'',kind:'all' as const,page:1};
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('release history cache admission', () => {
  it('admits complete records without warning when optional metadata is absent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await createHistoryCacheLoader(async () => result)(filters)).toBe(result);
    expect(warn).not.toHaveBeenCalled();
  });
  it('admits repeated partial results without throwing and warns at most once per TTL', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const partial = {...result,rows:result.rows.map(row=>({...row,detailsUnavailable:true}))};
    const load = createHistoryCacheLoader(async () => partial);
    const reads = await Promise.all(Array.from({length:10}, () => load(filters)));
    expect(reads.every(read => read === partial && read.rows[0].detailsUnavailable)).toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith('Catalog release history details unavailable', {unavailablePairs:1,rows:1,retryAfterSeconds:HISTORY_CACHE_SECONDS});
    await vi.advanceTimersByTimeAsync(HISTORY_CACHE_SECONDS * 1000 - 1);
    await load({...filters,query:'a different key'});
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await load(filters);
    expect(warn).toHaveBeenCalledTimes(2);
  });
  it('propagates real source errors so Next can retain its stale value', async () => {
    const error = new Error('Catalog history unavailable');
    await expect(createHistoryCacheLoader(async () => {throw error;})(filters)).rejects.toBe(error);
  });
});
