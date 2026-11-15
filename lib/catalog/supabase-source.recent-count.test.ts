import {afterEach, expect, it, vi} from 'vitest';
import {SupabaseCatalogSource} from './supabase-source';
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('counts recent updates without fetching a full history page', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','fixture-key');
  const fetch = vi.fn(async (input: RequestInfo | URL) => Response.json(String(input).includes('get_catalog_recent_update_count') ? 7 : {rows:[],total:7}));
  vi.stubGlobal('fetch',fetch);
  const source = new SupabaseCatalogSource();
  await expect(source.countReleaseHistory({query:'',month:'',kind:'updated',page:1,from:'2026-11-08'})).resolves.toBe(7);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0][0])).toContain('/rpc/get_catalog_recent_update_count');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({date_from:'2026-11-08'});
});

it('keeps the existing anonymous-only server fallback', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','fixture-anon');
  const fetch = vi.fn().mockResolvedValue(Response.json({rows:[],total:9}));
  vi.stubGlobal('fetch',fetch);
  await expect(new SupabaseCatalogSource().countReleaseHistory({query:'',month:'',kind:'updated',page:1,from:'2026-11-08'})).resolves.toBe(9);
  expect(String(fetch.mock.calls[0][0])).toContain('/rpc/get_catalog_release_history_v2');
  expect(new Headers(fetch.mock.calls[0][1].headers).get('apikey')).toBe('fixture-anon');
});
it.each([null,'12',-1,1.5])('rejects a malformed recent count %s', async total => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','fixture-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(total)));
  await expect(new SupabaseCatalogSource().countReleaseHistory({query:'',month:'',kind:'updated',page:1,from:'2026-11-09'})).rejects.toThrow('Catalog history unavailable');
});
it.each([{app:'Fixture.App'},{query:'fixture'},{month:'2026-11'},{to:'2026-11-15'},{architecture:'x64'},{kind:'all'},{kind:'first'},{page:2},{from:undefined}])('keeps other count filters on the existing RPC %j', async changes => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','fixture-key');
  const fetch = vi.fn().mockResolvedValue(Response.json({rows:[],total:5}));
  vi.stubGlobal('fetch',fetch);
  await expect(new SupabaseCatalogSource().countReleaseHistory({...{query:'',month:'',kind:'updated' as const,page:1,from:'2026-11-08'},...changes})).resolves.toBe(5);
  expect(String(fetch.mock.calls[0][0])).toContain('/rpc/get_catalog_release_history_v2');
});
