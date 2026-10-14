import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({
  user: { userId: 'owner', tenantId: 'tenant' } as { userId: string; tenantId: string } | null,
  sqlite: true, configured: true,
  list: vi.fn(), save: vi.fn(), remove: vi.fn(), resolve: vi.fn(),
}));
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: vi.fn(async () => mocks.user) }));
vi.mock('@/lib/db', () => ({ isSqliteMode: () => mocks.sqlite, getDatabase: () => ({ customAppDefinitions: { list: mocks.list, save: mocks.save, delete: mocks.remove } }) }));
vi.mock('@/lib/supabase', () => ({ createServerClient: () => 'fixture-client', isSupabaseServerConfigured: () => mocks.configured }));
vi.mock('@/lib/msp/tenant-resolution', () => ({ resolveTargetTenantId: mocks.resolve }));
import { GET, POST, DELETE } from './route';

const definition = { displayName: 'Fixture', publisher: 'Fixture', installerType: 'msi', architecture: 'x64', installScope: 'machine' };
const id = '11111111-1111-4111-8111-111111111111';
const req = (method = 'GET', body?: unknown, headers: Record<string, string> = {}, query = '') => new NextRequest(`http://localhost/api/custom-apps${query}`, { method, headers: { Authorization: 'Bearer offline-fixture', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.user = { userId: 'owner', tenantId: 'tenant' }; mocks.sqlite = true; mocks.configured = true;
  mocks.list.mockResolvedValue([]); mocks.save.mockResolvedValue({ id, definition }); mocks.remove.mockResolvedValue(true); mocks.resolve.mockResolvedValue({ tenantId: 'customer', errorResponse: null });
});

describe('saved custom app API', () => {
  it.each([GET, POST, DELETE])('rejects unauthenticated requests', async handler => {
    mocks.user = null;
    expect((await handler(req())).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('uses authenticated owner and returns bounded uncached pages', async () => {
    mocks.list.mockResolvedValue(Array.from({ length: 51 }, () => ({ id, definition })));
    const response = await GET(req('GET', undefined, {}, '?offset=50'));
    expect(mocks.list).toHaveBeenCalledWith('owner', 'tenant', 51, 50);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const result = await response.json(); expect(result.definitions).toHaveLength(50); expect(result.hasMore).toBe(true);
  });
  it.each(['-1', '1.5', '10001', 'abc'])('rejects invalid page %s', async offset => {
    expect((await GET(req('GET', undefined, {}, `?offset=${offset}`))).status).toBe(400);
  });
  it.each([GET, POST, DELETE])('rejects a mismatched SQLite MSP tenant', async handler => {
    expect((await handler(req('GET', undefined, { 'X-MSP-Tenant-Id': 'customer' }))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('honors hosted MSP resolution and a primary tenant denial', async () => {
    mocks.sqlite = false;
    await GET(req('GET', undefined, { 'X-MSP-Tenant-Id': 'customer' }));
    expect(mocks.resolve).toHaveBeenCalledWith({ supabase: 'fixture-client', userId: 'owner', tokenTenantId: 'tenant', requestedTenantId: 'customer' });
    expect(mocks.list).toHaveBeenCalledWith('owner', 'customer', 51, 0);
    mocks.list.mockClear(); mocks.resolve.mockResolvedValue({ tenantId: 'tenant', errorResponse: NextResponse.json({ error: 'Customer only membership' }, { status: 403 }) });
    expect((await GET(req())).status).toBe(403); expect(mocks.list).not.toHaveBeenCalled();
  });
  it('creates and updates static details without accepting owner fields', async () => {
    expect((await POST(req('POST', { definition }))).status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith('owner', 'tenant', definition, undefined);
    expect((await POST(req('POST', { id, definition }))).status).toBe(200);
    expect(mocks.save).toHaveBeenLastCalledWith('owner', 'tenant', definition, id);
    expect((await POST(req('POST', { definition, tenant_id: 'other' }))).status).toBe(400);
  });
  it.each([{ id: 'bad', definition }, { definition: { ...definition, installerUrl: 'https://example.test/private?sig=fixture' } }, { definition: { ...definition, architecture: 'unknown' } }, { definition: { ...definition, silentSwitches: 42 } }])('rejects malformed or secret-bearing definitions', async body => {
    const response = await POST(req('POST', body));
    expect(response.status).toBe(400); expect(mocks.save).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('sig=');
  });
  it('bounds request bytes', async () => {
    expect((await POST(req('POST', { definition, junk: 'x'.repeat(16384) }))).status).toBe(413);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(['x'.repeat(16000), '\u20ac'.repeat(5334)])('reserves space for JSONB text formatting at the byte boundary', async junk => {
    expect((await POST(req('POST', { definition, junk }))).status).toBe(413);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('returns404 for inaccessible update and delete IDs', async () => {
    mocks.save.mockResolvedValue(null); mocks.remove.mockResolvedValue(false);
    expect((await POST(req('POST', { id, definition }))).status).toBe(404);
    expect((await DELETE(req('DELETE', undefined, {}, `?id=${id}`))).status).toBe(404);
    expect(mocks.remove).toHaveBeenCalledWith('owner', 'tenant', id);
  });
  it('validates deletion IDs and handles unavailable storage without leaking data', async () => {
    expect((await DELETE(req('DELETE', undefined, {}, '?id=bad'))).status).toBe(400);
    mocks.sqlite = false; mocks.configured = false;
    expect((await GET(req())).status).toBe(503);
    mocks.sqlite = true; mocks.list.mockRejectedValue(new Error('secret fixture URL'));
    const response = await GET(req()); expect(response.status).toBe(500); expect(await response.text()).not.toContain('secret fixture URL');
  });
});
