import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({ authenticated: true, authorized: true, profileExists: false, profileError: false, mappingWrites: 0, profileWrites: [] as unknown[] }));
const user = { userId: '00000000-0000-4000-8000-000000000001', tenantId: 'home-tenant', userEmail: 'fixture@example.test', userName: 'Fixture User' };
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => state.authenticated ? user : null }));
vi.mock('@/lib/db', () => ({ isSqliteMode: () => false }));
vi.mock('@/lib/msp/tenant-resolution', () => ({ resolveTargetTenantId: async () => state.authorized ? { tenantId: 'target-tenant' } : { errorResponse: new Response('{}', { status: 403 }) } }));
vi.mock('@/lib/supabase', () => ({ isSupabaseServerConfigured: () => true, createServerClient: () => ({
  from: (table: string) => {
    if (table === 'user_profiles') return { upsert: async (row: unknown, options: unknown) => { state.profileWrites.push({ row, options }); if (state.profileError) return { error: { code: 'fixture-error' } }; state.profileExists = true; return { error: null }; } };
    const chain: any = { select: () => chain, eq: () => chain, single: async () => ({ data: null, error: { code: 'PGRST116' } }), update: () => chain, ilike: async () => ({ error: null }) };
    if (table === 'manual_app_mappings') chain.insert = (row: any) => { state.mappingWrites++; return { select: () => ({ single: async () => state.profileExists ? { data: { ...row, id: 'fixture-mapping' }, error: null } : { data: null, error: { code: '23503' } } }) }; };
    return chain;
  }
}) }));
import { POST } from './route';
const request = () => new NextRequest('http://localhost/api/mappings', { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ discoveredAppName: 'Fixture App', wingetPackageId: 'Fixture.App' }) });
describe('hosted mapping creator profile', () => {
  beforeEach(() => { state.authenticated = true; state.authorized = true; state.profileExists = false; state.profileError = false; state.mappingWrites = 0; state.profileWrites = []; });
  it('creates the authenticated creator profile before the foreign key dependent mapping', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(state.profileWrites).toEqual([{ row: expect.objectContaining({ id: user.userId, email: user.userEmail, name: user.userName, intune_tenant_id: user.tenantId }), options: { onConflict: 'id', ignoreDuplicates: true } }]);
    expect(await response.json()).toMatchObject({ mapping: { tenantId: 'target-tenant', createdBy: user.userId } });
  });
  it('does not overwrite an existing profile', async () => {
    state.profileExists = true;
    expect((await POST(request())).status).toBe(201);
    expect(state.profileWrites).toEqual([{ row: expect.anything(), options: { onConflict: 'id', ignoreDuplicates: true } }]);
  });
  it('stops mapping persistence when profile creation fails', async () => {
    state.profileError = true;
    expect((await POST(request())).status).toBe(500);
    expect(state.mappingWrites).toBe(0);
  });
  it.each([401, 403])('does not create profiles before authorization (%s)', async status => {
    state.authenticated = status !== 401; state.authorized = status !== 403;
    expect((await POST(request())).status).toBe(status);
    expect(state.profileWrites).toEqual([]); expect(state.mappingWrites).toBe(0);
  });
});
