import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
type CacheRow = Record<string, unknown> & { tenant_id: string; discovered_app_id: string; last_synced: string };
const { upsert, prune, from, cache } = vi.hoisted(() => ({
  upsert: vi.fn(), prune: vi.fn(), from: vi.fn(), cache: { rows: [] as CacheRow[], maxRows: 2 },
}));
vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: () => true, createServerClient: () => ({ from }) }));
vi.mock('@/lib/msp/tenant-resolution', () => ({ resolveTargetTenantId: async () => ({ tenantId: 'tenant-fixture' }) }));
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => ({ userId: 'user-fixture', tenantId: 'tenant-fixture' }) }));
vi.mock('@/lib/intune/graph-client', () => ({ getServicePrincipalToken: async () => 'offline-test-token', invalidateServicePrincipalToken: vi.fn() }));
vi.mock('@/lib/matching/app-matcher', () => ({
  filterUserApps: (apps: unknown[]) => apps, isSystemApp: () => false,
  normalizeAppName: (name: string) => name.toLowerCase(),
  matchDiscoveredApp: () => ({ status: 'unmatched', wingetId: null, wingetName: null, confidence: 0, partialMatches: [] }),
}));
import { GET } from './route';
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T10:00:00.000Z'));
  cache.rows = [
    { tenant_id: 'tenant-fixture', discovered_app_id: 'app-old', last_synced: '2026-10-09T10:00:00.000Z' },
    { tenant_id: 'tenant-fixture', discovered_app_id: 'app-one', last_synced: '2026-10-09T10:00:00.000Z' },
    { tenant_id: 'other-tenant-fixture', discovered_app_id: 'app-one', last_synced: '2026-10-09T10:00:00.000Z' },
    { tenant_id: 'other-tenant-fixture', discovered_app_id: 'other-old', last_synced: '2026-10-09T10:00:00.000Z' },
    { tenant_id: 'tenant-fixture', discovered_app_id: 'app-future', last_synced: '2026-10-11T10:00:00.000Z' },
  ];
  upsert.mockImplementation(async (rows: CacheRow[], options: { onConflict: string }) => {
    expect(options.onConflict).toBe('tenant_id,discovered_app_id');
    const next = structuredClone(cache.rows);
    for (const row of rows) {
      const index = next.findIndex(old => old.tenant_id === row.tenant_id && old.discovered_app_id === row.discovered_app_id);
      if (index === -1) next.push(structuredClone(row));
      else next[index] = structuredClone(row);
    }
    cache.rows = next;
    return { error: null };
  });
  from.mockImplementation((table: string) => {
    if (!['discovered_apps_cache', 'tenant_consent', 'claimed_apps', 'manual_app_mappings'].includes(table)) throw new Error('Unsupported fake table');
    const query: Record<string, unknown> = {};
    const predicates: ((row: CacheRow) => boolean)[] = [];
    let deleting = false;
    let projection = '*';
    query.select = vi.fn((columns: string) => { projection = columns; return query; });
    query.eq = vi.fn((column: string, value: unknown) => { predicates.push(row => row[column] === value); return query; });
    query.lt = vi.fn((column: string, value: string) => { predicates.push(row => String(row[column]) < value); return query; });
    query.order = vi.fn(() => query);
    query.or = vi.fn((expression: string) => {
      expect(table).toBe('manual_app_mappings');
      expect(expression).toBe('tenant_id.eq.tenant-fixture,tenant_id.is.null');
      return query;
    });
    query.single = vi.fn(async () => ({ data: {}, error: null }));
    query.then = (resolve: (value: unknown) => unknown) => {
      const matches = (row: CacheRow) => predicates.every(predicate => predicate(row));
      if (deleting) {
        cache.rows = cache.rows.filter(row => !matches(row));
        return Promise.resolve({ data: null, error: null }).then(resolve);
      }
      const rows = table === 'discovered_apps_cache' ? cache.rows.filter(matches).slice(0, cache.maxRows) : [];
      const data = projection === '*' ? rows : rows.map(row => Object.fromEntries(projection.split(',').map(column => [column.trim(), row[column.trim()]])));
      return Promise.resolve({ data: structuredClone(data), error: null }).then(resolve);
    };
    query.upsert = upsert;
    query.delete = vi.fn(() => { expect(table).toBe('discovered_apps_cache'); deleting = true; prune(table); return query; });
    return query;
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ value: [
    { id: 'app-one', displayName: 'First app', platform: 'windows', deviceCount: 3 },
    { id: 'app-two', displayName: 'Second app', platform: 'windows', deviceCount: 2 },
  ] }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const refresh = () => GET(new NextRequest('http://localhost/api/intune/unmanaged-apps?refresh=true', {
  headers: { Authorization: 'Bearer offline-test-token' },
}));
describe('discovered apps cache preservation', () => {
  it('returns the completed fresh scan and preserves the cache when the replacement rejects', async () => {
    const before = structuredClone(cache.rows);
    upsert.mockRejectedValue(new Error('cache unavailable'));
    const response = await refresh();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.fromCache).toBe(false);
    expect(result.apps.map((app: { discoveredAppId: string }) => app.discoveredAppId)).toEqual(['app-one', 'app-two']);
    expect(upsert).toHaveBeenCalledOnce();
    expect(prune).not.toHaveBeenCalled();
    expect(cache.rows).toEqual(before);
  });
  it('keeps the previous cache when the replacement write fails and still returns fresh results', async () => {
    const before = structuredClone(cache.rows);
    upsert.mockResolvedValue({ error: { code: 'write-failed' } });
    const response = await refresh();
    expect(response.status).toBe(200);
    expect((await response.json()).apps).toHaveLength(2);
    expect(upsert).toHaveBeenCalledOnce();
    expect(prune).not.toHaveBeenCalled();
    expect(cache.rows).toEqual(before);
  });
  it('prunes stale rows after a successful complete replacement', async () => {
    expect((await refresh()).status).toBe(200);
    expect(upsert).toHaveBeenCalledOnce();
    expect(prune).toHaveBeenCalledExactlyOnceWith('discovered_apps_cache');
    expect(cache.rows.map(row => `${row.tenant_id}/${row.discovered_app_id}`).sort()).toEqual([
      'other-tenant-fixture/app-one', 'other-tenant-fixture/other-old',
      'tenant-fixture/app-future', 'tenant-fixture/app-one', 'tenant-fixture/app-two',
    ]);
    expect(cache.rows.find(row => row.tenant_id === 'tenant-fixture' && row.discovered_app_id === 'app-one')?.last_synced).toBe('2026-10-10T10:00:00.000Z');
  });
  it('still clears stale rows when a successful complete scan finds no apps', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ value: [] }), { status: 200 })));
    const response = await refresh();
    expect(response.status).toBe(200);
    expect((await response.json()).apps).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
    expect(prune).toHaveBeenCalledExactlyOnceWith('discovered_apps_cache');
    expect(cache.rows.map(row => `${row.tenant_id}/${row.discovered_app_id}`).sort()).toEqual([
      'other-tenant-fixture/app-one', 'other-tenant-fixture/other-old', 'tenant-fixture/app-future',
    ]);
  });
  it('upserts repeated scans by the tenant and discovered app key without duplicates', async () => {
    expect((await refresh()).status).toBe(200);
    expect((await refresh()).status).toBe(200);
    expect(cache.rows.filter(row => row.tenant_id === 'tenant-fixture' && row.discovered_app_id === 'app-one')).toHaveLength(1);
    expect(cache.rows.filter(row => row.tenant_id === 'tenant-fixture' && row.discovered_app_id === 'app-two')).toHaveLength(1);
    expect(cache.rows.filter(row => row.tenant_id === 'other-tenant-fixture')).toHaveLength(2);
  });
  it('does not prune when a paginated scan exceeds its overall time budget', async () => {
    cache.rows = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      vi.setSystemTime(new Date('2026-10-10T10:01:00.000Z'));
      return new Response(JSON.stringify({ value: [
        { id: 'partial-app', displayName: 'Partial app', platform: 'windows', deviceCount: 1 },
      ], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/deviceManagement/detectedApps?synthetic-page=2' }), { status: 200 });
    }));
    const response = await refresh();
    expect(response.status).toBe(200);
    expect((await response.json()).apps).toHaveLength(1);
    expect(prune).not.toHaveBeenCalled();
  });
});
