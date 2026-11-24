import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({
  row: { id: 'fixture-job', updated_at: '2026-01-01T00:00:00.123456Z', package_config: { description: 'x'.repeat(100_000), relationships: [] } },
  filters: [] as Array<[string, unknown]>, saved: false, race: false,
}));
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => ({ userId: 'owner', tenantId: 'tenant' }) }));
vi.mock('@/lib/msp/tenant-resolution', () => ({ resolveTargetTenantId: async () => ({ tenantId: 'tenant', errorResponse: null }) }));
vi.mock('@/lib/intune/graph-client', () => ({ getServicePrincipalToken: async () => 'fixture-token' }));
vi.mock('@/lib/intune-api', () => ({ getApp: async () => ({ id: 'fixture-app' }), syncAppCategories: async () => undefined }));
vi.mock('@/lib/intune-relationships', () => ({
  syncAppRelationships: async (_token: string, _app: string, _baseline: unknown, desired: unknown) => desired,
  RelationshipUpdateError: class extends Error {},
}));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({ jobs: { getLatestDeployed: async () => state.row } }) }));
vi.mock('@/lib/supabase', () => ({ getServerClientOrNull: () => ({
  from: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let patch: Record<string, unknown> | undefined;
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
      is: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
      single: async () => ({ data: table === 'tenant_consent', error: null }),
      update: (value: Record<string, unknown>) => { patch = value; return chain; },
      maybeSingle: async () => {
        if (!patch) return { data: state.row, error: null };
        state.filters = filters;
        const version = filters.find(([column]) => column === 'updated_at');
        if (state.race || version?.[1] !== state.row.updated_at) return { data: null, error: null };
        state.saved = true;
        return { data: { id: state.row.id }, error: null };
      },
    };
    return chain;
  },
}) }));
import { PATCH } from './route';
const call = (body = { wingetId: 'Fixture.App', relationships: [], baselineRelationships: [] } as Record<string, unknown>) => PATCH(new NextRequest('https://fixture.invalid/api/settings', { method: 'PATCH',
  headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify(body) }),
{ params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) });
describe('hosted relationship persistence', () => {
  beforeEach(() => { state.filters = []; state.saved = false; state.race = false; });
  it('saves with the exact timestamp and ownership filters without putting a large configuration in the URL', async () => {
    expect((await call()).status).toBe(200);
    expect(state.saved).toBe(true);
    expect(state.filters).toContainEqual(['updated_at', state.row.updated_at]);
    for (const column of ['id', 'user_id', 'tenant_id', 'winget_id', 'intune_app_id', 'status', 'archived_at']) expect(state.filters.some(([name]) => name === column)).toBe(true);
    expect(state.filters.some(([name]) => name === 'package_config')).toBe(false);
    expect(JSON.stringify(state.filters).length).toBeLessThan(1000);
  });
  it('reports Graph applied but refuses to overwrite a concurrently updated configuration', async () => {
    state.race = true;
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ applied: ['relationships'] });
    expect(state.saved).toBe(false);
  });
  it('guards a category save with the exact snapshot timestamp', async () => {
    expect((await call({ wingetId: 'Fixture.App', categories: [] })).status).toBe(200);
    expect(state.filters).toContainEqual(['updated_at', state.row.updated_at]);
    expect(state.saved).toBe(true);
  });
});
