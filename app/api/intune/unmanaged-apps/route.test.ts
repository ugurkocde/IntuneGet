import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const { upsert, prune, from } = vi.hoisted(() => ({ upsert: vi.fn(), prune: vi.fn(), from: vi.fn() }));
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
  upsert.mockResolvedValue({ error: null });
  from.mockImplementation((table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'or', 'lt']) query[method] = vi.fn(() => query);
    query.single = vi.fn(async () => ({ data: {}, error: null }));
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    query.upsert = upsert;
    query.delete = vi.fn(() => { prune(table); return query; });
    return query;
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ value: [
    { id: 'app-one', displayName: 'First app', platform: 'windows', deviceCount: 3 },
    { id: 'app-two', displayName: 'Second app', platform: 'windows', deviceCount: 2 },
  ] }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => vi.unstubAllGlobals());
const refresh = () => GET(new NextRequest('http://localhost/api/intune/unmanaged-apps?refresh=true', {
  headers: { Authorization: 'Bearer offline-test-token' },
}));
describe('discovered apps cache preservation', () => {
  it('returns the completed fresh scan and preserves the cache when the replacement rejects', async () => {
    upsert.mockRejectedValue(new Error('cache unavailable'));
    const response = await refresh();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.fromCache).toBe(false);
    expect(result.apps.map((app: { discoveredAppId: string }) => app.discoveredAppId)).toEqual(['app-one', 'app-two']);
    expect(upsert).toHaveBeenCalledOnce();
    expect(prune).not.toHaveBeenCalled();
  });
  it('keeps the previous cache when the replacement write fails and still returns fresh results', async () => {
    upsert.mockResolvedValue({ error: { code: 'write-failed' } });
    const response = await refresh();
    expect(response.status).toBe(200);
    expect((await response.json()).apps).toHaveLength(2);
    expect(upsert).toHaveBeenCalledOnce();
    expect(prune).not.toHaveBeenCalled();
  });
  it('prunes stale rows after a successful complete replacement', async () => {
    expect((await refresh()).status).toBe(200);
    expect(upsert).toHaveBeenCalledOnce();
    expect(prune).toHaveBeenCalledExactlyOnceWith('discovered_apps_cache');
  });
  it('still clears stale rows when a successful complete scan finds no apps', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ value: [] }), { status: 200 })));
    const response = await refresh();
    expect(response.status).toBe(200);
    expect((await response.json()).apps).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
    expect(prune).toHaveBeenCalledExactlyOnceWith('discovered_apps_cache');
  });
});
