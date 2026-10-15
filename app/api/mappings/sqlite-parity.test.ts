import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const session = vi.hoisted(() => {
  vi.stubEnv('DATABASE_PATH', ':memory:');
  vi.stubEnv('DATABASE_MODE', 'sqlite');
  return { tenant: 'tenant-one', signedIn: true, sqlite: true };
});
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => session.signedIn ? { userId: 'fixture-user', tenantId: session.tenant } : null }));
vi.mock('@/lib/supabase', () => ({ isSupabaseServerConfigured: () => false, createServerClient: vi.fn(() => { throw Error('Hosted database must not be used'); }) }));
vi.mock('@/lib/db', async () => {
  const { sqliteDb } = await vi.importActual<typeof import('@/lib/db/sqlite')>('@/lib/db/sqlite');
  return { isSqliteMode: () => session.sqlite, getDatabase: () => sqliteDb };
});
import { closeSqliteDb } from '@/lib/db/sqlite';
import { createServerClient } from '@/lib/supabase';
import { GET, POST, DELETE } from './route';
const req = (method: string, body?: unknown, id?: string, tenant?: string) => new NextRequest(`http://localhost/api/mappings${id ? '?id=' + encodeURIComponent(id) : ''}`, { method, headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json', ...(tenant ? { 'X-MSP-Tenant-Id': tenant } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const input = { discoveredAppName: "  Fixture O'Brien  ", discoveredPublisher: 'Fixture', wingetPackageId: 'Fixture.Editor' };
describe('local mapping persistence through the existing API', () => {
  beforeEach(() => { closeSqliteDb(); session.tenant = 'tenant-one'; session.signedIn = true; session.sqlite = true; vi.clearAllMocks(); });
  afterAll(() => { closeSqliteDb(); vi.unstubAllEnvs(); });
  it('links, replaces, lists and unlinks without hosted services', async () => {
    const first = await POST(req('POST', input));
    expect(first.status).toBe(201);
    const { mapping } = await first.json();
    expect(mapping).toMatchObject({ discoveredAppName: "fixture o'brien", tenantId: 'tenant-one', createdBy: 'fixture-user', isVerified: false });
    const second = await POST(req('POST', { ...input, wingetPackageId: 'Fixture.NewEditor' }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ updated: true, mapping: { id: mapping.id, wingetPackageId: 'Fixture.NewEditor' } });
    expect((await (await GET(req('GET'))).json()).mappings).toHaveLength(1);
    expect((await DELETE(req('DELETE', undefined, mapping.id))).status).toBe(200);
    expect((await (await GET(req('GET'))).json()).mappings).toEqual([]);
    expect(createServerClient).not.toHaveBeenCalled();
  });
  it('does not expose or delete another tenant mapping', async () => {
    const { mapping } = await (await POST(req('POST', input))).json();
    session.tenant = 'tenant-two';
    expect((await (await GET(req('GET'))).json()).mappings).toEqual([]);
    expect((await DELETE(req('DELETE', undefined, mapping.id))).status).toBe(404);
    session.tenant = 'tenant-one';
    expect((await (await GET(req('GET'))).json()).mappings).toHaveLength(1);
  });
  it('rejects a cross tenant header before persistence', async () => {
    expect((await POST(req('POST', input, undefined, 'tenant-two'))).status).toBe(403);
    expect((await GET(req('GET', undefined, undefined, 'tenant-two'))).status).toBe(403);
    expect((await DELETE(req('DELETE', undefined, 'unknown', 'tenant-two'))).status).toBe(403);
  });
  it('requires authentication for local writes', async () => {
    session.signedIn = false;
    expect((await POST(req('POST', input))).status).toBe(401);
    expect((await DELETE(req('DELETE', undefined, 'unknown'))).status).toBe(401);
  });
  it.each([{}, { ...input, discoveredAppName: ' ' }, { ...input, discoveredAppName: 7 }, { ...input, wingetPackageId: ['Fixture.Editor'] }])('rejects malformed mapping input %#', async body => {
    expect((await POST(req('POST', body))).status).toBe(400);
  });
  it('keeps unsupported storage unavailable', async () => {
    session.sqlite = false;
    expect((await POST(req('POST', input))).status).toBe(503);
    expect((await DELETE(req('DELETE', undefined, 'unknown'))).status).toBe(503);
    expect(await (await GET(req('GET'))).json()).toEqual({ mappings: [] });
  });
});
