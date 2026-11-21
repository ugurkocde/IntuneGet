vi.mock('./history-transport', () => ({ isolatedHistoryFetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) }));

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


it.each(['getReleaseHistory', 'countReleaseHistory'] as const)('cancels late %s body within the total budget and releases capacity for another route', async method => {
  vi.useFakeTimers();
  const { SupabaseCatalogSource } = await import('./supabase-source');
  const { executeRevalidates } = await import('next/dist/server/revalidation-utils');
  const { AfterContext } = await import('next/dist/server/after/after-context');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://catalog.example.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-fixture-key');
  const signals: AbortSignal[] = [];
  let stopped = false;
  let stopBody: (() => void) | undefined;
  vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
    const signal = init.signal as AbortSignal; signals.push(signal);
    return new Response(new ReadableStream({start(controller) {
      const stop = () => {stopped = true; controller.error(signal.reason ?? new DOMException("Fixture cleanup", "AbortError"));};
      stopBody = stop;
      if (signal.aborted) stop(); else signal.addEventListener('abort', stop, {once:true});
    }}));
  }));
  const lastGood = method === 'getReleaseHistory' ? {rows:[],total:3} : 3;
  const cache = {generateSimpleCacheKey:async(key:string)=>key,
    get:vi.fn(async()=>({isStale:true,value:{kind:'FETCH',data:{body:JSON.stringify(lastGood)}}})),set:vi.fn(async()=>{})};
  vi.stubGlobal('__incrementalCache',cache);
  const kept: Promise<unknown>[] = [];
  const source = new SupabaseCatalogSource();
  const afterContext = new AfterContext({waitUntil:(p:Promise<unknown>)=>{kept.push(p);},onClose:()=>{},onTaskError:()=>{}});
  const store = {nextFetchId:1,route:'/apps/releases',pendingRevalidates:{},isStaticGeneration:false,afterContext};
  const callback = unstable_cache(()=>source[method]({query:'',month:'',kind:'all',page:1}),['bounded-late',method],{revalidate:300});
  vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
    await executeRevalidates(store as never);
    expect(await workAsyncStorage.run(store as never,()=>callback())).toEqual(lastGood);
    await vi.advanceTimersByTimeAsync(0);
    expect(signals).toHaveLength(1);expect(kept).toHaveLength(1);
    const join = Promise.allSettled([workAsyncStorage.run({...store,route:'/feed',pendingRevalidates:{}} as never,()=>source[method]({query:'',month:'',kind:'all',page:1}))]);
    await vi.advanceTimersByTimeAsync(9000);
    expect(stopped).toBe(true);expect(signals[0].aborted).toBe(true);
    expect((await join)[0].status).toBe('rejected');await Promise.all(kept);
    expect(await Promise.all(Array.from({length:4},()=>withHistoryCapacity(async()=>'other route')))).toEqual(Array(4).fill('other route'));
    expect(cache.set).not.toHaveBeenCalled();
  } finally {
    if (!stopped) stopBody?.();
    await vi.advanceTimersByTimeAsync(20000);
    await Promise.allSettled(Object.values(store.pendingRevalidates));
    vi.useRealTimers();vi.unstubAllEnvs();
  }
});


it('bounds keepalive even for an abort-ignoring transport without releasing its live capacity slot', async () => {
  vi.useFakeTimers();
  const {SupabaseCatalogSource} = await import('./supabase-source');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://catalog.example.invalid');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','synthetic-fixture-key');
  let finish!: (r:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{finish=r;})));
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  const occupied=Array.from({length:3},()=>withHistoryCapacity(()=>gate));
  const kept: Promise<unknown>[]=[];
  const source=new SupabaseCatalogSource();
  const pending=workAsyncStorage.run({afterContext:{after:(p:Promise<unknown>)=>kept.push(p)}} as never,()=>source.countReleaseHistory({query:'',month:'',kind:'all',page:1}));
  const settled=Promise.allSettled([pending]);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(9000);
  expect((await settled)[0].status).toBe('rejected');await Promise.all(kept);
  let admitted=false;
  const next=withHistoryCapacity(async()=>{admitted=true;});
  await vi.advanceTimersByTimeAsync(0);expect(admitted).toBe(false);
  finish(Response.json({rows:[],total:1}));
  await vi.advanceTimersByTimeAsync(0);await next;expect(admitted).toBe(true);
  release();await Promise.all(occupied);vi.useRealTimers();vi.unstubAllEnvs();
});


it('does not cache a refresh when the total deadline interrupts reputation enrichment', async () => {
  vi.useFakeTimers();
  const {SupabaseCatalogSource}=await import('./supabase-source');
  const {createHistoryLoader}=await import('./release-history-cache');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://catalog.example.invalid');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','synthetic-fixture-key');
  const row={winget_id:'Fixture.App',version:'1',name:'Fixture',publisher:null,previous_version:null,detected_at:'2026-01-01T00:00:00Z',release_date:null};
  let reputationSignal:AbortSignal|undefined;let cleanup:()=>void=()=>{};
  vi.stubGlobal('fetch',vi.fn(async(input,init)=>{
    if(String(input).includes('/rpc/')) return Response.json({rows:[row],total:1});
    if(String(input).includes('/version_history')) return Response.json([{winget_id:row.winget_id,version:row.version,release_notes_url:null,installer_sha256:'a'.repeat(64)}]);
    reputationSignal=init.signal;
    return new Promise<Response>((_,reject)=>{cleanup=()=>reject(new DOMException('Fixture cancellation','AbortError'));reputationSignal!.addEventListener('abort',cleanup,{once:true});});
  }));
  const lastGood={rows:[row],total:1};
  const cache={generateSimpleCacheKey:async(key:string)=>key,get:vi.fn(async()=>({isStale:true,value:{kind:'FETCH',data:{body:JSON.stringify(lastGood)}}})),set:vi.fn(async()=>{})};
  vi.stubGlobal('__incrementalCache',cache);vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
  const kept:Promise<unknown>[]=[];const source=new SupabaseCatalogSource();
  const store={nextFetchId:1,route:'/apps/releases',pendingRevalidates:{},isStaticGeneration:false,afterContext:{after:(p:Promise<unknown>)=>kept.push(p)}};
  const callback=createHistoryLoader(filters => source.getReleaseHistory(filters));
  try {
    expect(await workAsyncStorage.run(store as never,()=>callback({query:'',month:'',kind:'all',page:1}))).toEqual(lastGood);
    await vi.advanceTimersByTimeAsync(0);expect(reputationSignal).toBeDefined();
    await vi.advanceTimersByTimeAsync(9000);expect(reputationSignal!.aborted).toBe(true);
    await Promise.all(kept);await Promise.all(Object.values(store.pendingRevalidates));
    expect(cache.set).not.toHaveBeenCalled();
  } finally {cleanup();await vi.advanceTimersByTimeAsync(20000);await Promise.allSettled(Object.values(store.pendingRevalidates));vi.useRealTimers();vi.unstubAllEnvs();}
});

it.each(['partial', 'missing_metadata', 'reputation_failure'] as const)(
  'stores a %s refresh using the production Next wrapper and recovers on a later refresh', async scenario => {
    vi.useFakeTimers();
    const { SupabaseCatalogSource } = await import('./supabase-source');
    const { createHistoryLoader, HISTORY_CACHE_SECONDS } = await import('./release-history-cache');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://catalog.example.invalid');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-fixture-key');
    const row = {winget_id:'PrivateFixture.App',version:'1',name:'Fixture',publisher:null,previous_version:null,detected_at:'2026-01-01T00:00:00Z',release_date:null};
    const filters = {query:'private fixture search',month:'',kind:'all' as const,page:1};
    let recover = false;
    const fetch = vi.fn(async (input: unknown) => {
      if (String(input).includes('/rpc/')) return Response.json({rows:[row],total:1});
      if (String(input).includes('/version_history')) {
        if (scenario === 'partial' && !recover) return Response.json({}, {status:500});
        if (scenario === 'missing_metadata') return Response.json([]);
        return Response.json([{winget_id:row.winget_id,version:row.version,release_notes_url:null,installer_sha256:'a'.repeat(64)}]);
      }
      return scenario === 'reputation_failure' ? Response.json({}, {status:500}) : Response.json([]);
    });
    vi.stubGlobal('fetch', fetch);
    const warn = vi.spyOn(console,'warn').mockImplementation(() => {});
    const error = vi.spyOn(console,'error').mockImplementation(() => {});
    const lastGood = {rows:[row],total:1};
    let body = JSON.stringify(lastGood);
    let stale = true;
    const cache = {
      generateSimpleCacheKey: async (key: string) => key,
      get: vi.fn(async () => ({isStale:stale,value:{kind:'FETCH',data:{body}}})),
      set: vi.fn(async (_key: string, value: {data:{body:string};revalidate:number}) => {body=value.data.body;stale=false;}),
    };
    vi.stubGlobal('__incrementalCache',cache);
    const source = new SupabaseCatalogSource();
    const callback = createHistoryLoader(f => source.getReleaseHistory(f));
    const run = async () => {
      const store = {nextFetchId:1,route:'/apps/releases',pendingRevalidates:{},isStaticGeneration:false};
      const result = await workAsyncStorage.run(store as never, () => callback(filters));
      await Promise.all(Object.values(store.pendingRevalidates));
      return result;
    };
    try {
      expect(await run()).toEqual(lastGood);
      expect(cache.set).toHaveBeenCalledTimes(1);
      expect(cache.set.mock.calls[0][1].revalidate).toBe(HISTORY_CACHE_SECONDS);
      const refreshed = JSON.parse(body);
      expect(Boolean(refreshed.rows[0].detailsUnavailable)).toBe(scenario === 'partial');
      const admissionWarnings = () => warn.mock.calls.filter(([message]) => message === 'Catalog release history details unavailable');
      expect(admissionWarnings()).toHaveLength(scenario === 'partial' ? 1 : 0);
      expect(JSON.stringify(admissionWarnings())).not.toContain(row.winget_id);
      expect(JSON.stringify(admissionWarnings())).not.toContain(filters.query);
      const calls = fetch.mock.calls.length;
      expect(await run()).toEqual(refreshed);
      expect(fetch).toHaveBeenCalledTimes(calls);
      // Even another refresh within the TTL cannot emit a second admission warning.
      stale = true;
      await run();
      expect(admissionWarnings()).toHaveLength(scenario === 'partial' ? 1 : 0);
      await vi.advanceTimersByTimeAsync(HISTORY_CACHE_SECONDS * 1000);
      stale = true;
      await run();
      expect(admissionWarnings()).toHaveLength(scenario === 'partial' ? 2 : 0);
      recover = true;
      stale = true;
      await run();
      expect(JSON.parse(body).rows[0].detailsUnavailable).toBeUndefined();
      expect(error.mock.calls.some(([message]) => String(message).includes('revalidating cache'))).toBe(false);
    } finally {vi.useRealTimers();vi.unstubAllEnvs();}
  },
);
