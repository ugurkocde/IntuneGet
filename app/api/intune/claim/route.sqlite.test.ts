import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';

const state = vi.hoisted(() => {
  vi.stubEnv('DATABASE_PATH', ':memory:');
  vi.stubEnv('DATABASE_MODE', 'sqlite');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  return { user: 'fixture-owner' as string | null, tenant: 'fixture-tenant', sqlite: true };
});
vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: async () => state.user
    ? { userId: state.user, tenantId: state.tenant, userEmail: 'fixture@example.test', userName: 'Fixture' } : null,
}));
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return { ...actual, createServerClient: vi.fn(actual.createServerClient) };
});
vi.mock('@/lib/db', async () => {
  const { sqliteDb } = await vi.importActual<typeof import('@/lib/db/sqlite')>('@/lib/db/sqlite');
  return { getDatabase: () => sqliteDb, isSqliteMode: () => state.sqlite };
});

import { sqliteDb, closeSqliteDb } from '@/lib/db/sqlite';
import { createServerClient } from '@/lib/supabase';
import { GET, PATCH, POST } from './route';

const request = (method: string, body?: unknown) => new NextRequest('http://localhost/api/intune/claim', {
  method, headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const claimBody = (discoveredAppId = randomUUID()) => ({
  discoveredAppId, discoveredAppName: 'Fixture App', wingetPackageId: 'Fixture.App', deviceCount: 7,
});
const stored = (tenantId = 'fixture-tenant') => sqliteDb.claimedApps.listByTenant(tenantId);

describe('app claims with the SQLite adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = 'fixture-owner'; state.tenant = 'fixture-tenant'; state.sqlite = true;
  });
  afterAll(() => { closeSqliteDb(); vi.unstubAllEnvs(); });

  it('stores a claim for the signed in tenant without Supabase', async () => {
    const body = claimBody();
    const response = await POST(request('POST', body));
    expect(response.status).toBe(201);
    const { claim } = await response.json();
    expect(claim).toMatchObject({
      userId: 'fixture-owner', tenantId: 'fixture-tenant', discoveredAppId: body.discoveredAppId,
      discoveredAppName: 'Fixture App', wingetPackageId: 'Fixture.App', deviceCountAtClaim: 7,
      intuneAppId: null, status: 'pending',
    });
    expect((await stored()).find(row => row.discovered_app_id === body.discoveredAppId)?.id).toBe(claim.id);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('re-claims an app in the same tenant as pending for the new claimant', async () => {
    const body = claimBody();
    const first = (await (await POST(request('POST', body))).json()).claim;
    await sqliteDb.claimedApps.update(first.id, 'fixture-tenant', { status: 'failed' });
    state.user = 'second-fixture-owner';
    const response = await POST(request('POST', { ...body, discoveredAppName: 'Renamed', wingetPackageId: 'Fixture.Other', deviceCount: 9 }));
    expect(response.status).toBe(201);
    expect((await response.json()).claim).toMatchObject({
      id: first.id, userId: 'second-fixture-owner', discoveredAppName: 'Fixture App',
      wingetPackageId: 'Fixture.Other', deviceCountAtClaim: 9, status: 'pending',
    });
    expect((await stored()).filter(row => row.discovered_app_id === body.discoveredAppId)).toHaveLength(1);
  });

  it('lists only the signed in tenant claims', async () => {
    const own = claimBody();
    await POST(request('POST', own));
    state.tenant = 'other-fixture-tenant';
    const other = claimBody();
    await POST(request('POST', other));
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    const ids = (await response.json()).claims.map((claim: { discoveredAppId: string }) => claim.discoveredAppId);
    expect(ids).toContain(other.discoveredAppId);
    expect(ids).not.toContain(own.discoveredAppId);
  });

  it('updates a claim only within the signed in tenant', async () => {
    const { claim } = await (await POST(request('POST', claimBody()))).json();
    const response = await PATCH(request('PATCH', { claimId: claim.id, status: 'deployed', intuneAppId: 'fixture-intune-app' }));
    expect(response.status).toBe(200);
    expect((await response.json()).claim).toMatchObject({ id: claim.id, status: 'deployed', intuneAppId: 'fixture-intune-app' });

    state.tenant = 'other-fixture-tenant';
    expect((await PATCH(request('PATCH', { claimId: claim.id, status: 'failed' }))).status).toBe(500);
    expect((await stored()).find(row => row.id === claim.id)?.status).toBe('deployed');
  });

  it('rejects an unknown claim status or an empty update', async () => {
    const { claim } = await (await POST(request('POST', claimBody()))).json();
    expect((await PATCH(request('PATCH', { claimId: claim.id, status: 'archived' }))).status).toBe(400);
    expect((await PATCH(request('PATCH', { claimId: claim.id, status: '' }))).status).toBe(400);
    expect((await PATCH(request('PATCH', { claimId: claim.id }))).status).toBe(400);
    expect((await stored()).find(row => row.id === claim.id)?.status).toBe('pending');
  });

  it('validates input and authentication before storing', async () => {
    const before = (await stored()).length;
    expect((await POST(request('POST', { discoveredAppId: randomUUID() }))).status).toBe(400);
    state.user = null;
    expect((await POST(request('POST', claimBody()))).status).toBe(401);
    expect((await GET(request('GET'))).status).toBe(401);
    expect((await PATCH(request('PATCH', { claimId: 'fixture', status: 'failed' }))).status).toBe(401);
    expect((await stored()).length).toBe(before);
  });

  it('still reports that claims need hosted services outside SQLite mode', async () => {
    state.sqlite = false;
    expect((await POST(request('POST', claimBody()))).status).toBe(503);
    expect((await PATCH(request('PATCH', { claimId: 'fixture', status: 'failed' }))).status).toBe(503);
    expect(await (await GET(request('GET'))).json()).toEqual({ claims: [] });
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
