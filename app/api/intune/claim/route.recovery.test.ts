import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  row: {} as Record<string, unknown>, transition: '', writes: 0,
}));
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => ({ userId: 'fixture-user', tenantId: 'fixture-tenant' }) }));
vi.mock('@/lib/db', () => ({ isSqliteMode: () => false }));
vi.mock('@/lib/msp/tenant-resolution', () => ({ resolveTargetTenantId: async () => ({ tenantId: 'fixture-tenant' }) }));
vi.mock('@/lib/supabase', () => ({
  isSupabaseServerConfigured: () => true,
  createServerClient: () => ({ from: (table: string) => {
    if (table === 'user_profiles') return { upsert: async () => ({ error: null }) };
    let update: Record<string, unknown> | null = null;
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const finish = async () => {
      if (!update) {
        const row = { ...state.row };
        if (state.transition) state.row.status = state.transition;
        return { data: row, error: null };
      }
      if (!filters.every(filter => filter(state.row))) return { data: null, error: null };
      state.writes++;
      Object.assign(state.row, update);
      return { data: { ...state.row }, error: null };
    };
    const query = {
      select: () => query,
      update: (value: Record<string, unknown>) => { update = value; return query; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      single: async () => {
        const result = await finish();
        return result.data ? result : { data: null, error: { message: 'PGRST116: expected one row' } };
      },
      maybeSingle: finish,
    };
    return query;
  } }),
}));
import { POST } from './route';

beforeEach(() => {
  state.row = { id: 'fixture-claim', tenant_id: 'fixture-tenant', discovered_app_id: 'fixture-app', status: 'pending', intune_app_id: 'fixture-intune' };
  state.transition = ''; state.writes = 0;
});
const recover = () => POST(new NextRequest('http://localhost/api/intune/claim', {
  method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
  body: JSON.stringify({ discoveredAppId: 'fixture-app', discoveredAppName: 'Fixture', wingetPackageId: 'Fixture.App' }),
}));

describe('hosted claim recovery', () => {
  it.each(['deploying', 'deployed'])('rejects an already %s claim', async status => {
    state.row.status = status;
    expect((await recover()).status).toBe(409);
    expect(state.row.status).toBe(status);
    expect(state.writes).toBe(0);
  });
  it.each(['deploying', 'deployed'])('does not overwrite a concurrent transition to %s', async status => {
    state.transition = status;
    expect((await recover()).status).toBe(409);
    expect(state.row.status).toBe(status);
    expect(state.writes).toBe(0);
  });
  it.each(['pending', 'failed'])('recovers a %s claim in place', async status => {
    state.row.status = status;
    const response = await recover();
    expect(response.status).toBe(201);
    expect((await response.json()).claim).toMatchObject({ id: 'fixture-claim', status: 'pending' });
    expect(state.writes).toBe(1);
  });
});
