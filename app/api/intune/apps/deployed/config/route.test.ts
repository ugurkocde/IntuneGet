import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { getServerClientOrNull: () => createClient('https://database.example.test', 'fixture-only', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchMock },
  }) };
});
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => ({ userId: 'fixture-owner', tenantId: 'fixture-tenant' }) }));
vi.mock('@/lib/msp/tenant-resolution', () => ({ resolveTargetTenantId: async () => ({ tenantId: 'fixture-tenant', errorResponse: null }) }));
vi.mock('@/lib/intune/graph-client', () => ({ getServicePrincipalToken: async () => 'fixture-token' }));
vi.mock('@/lib/intune-api', () => ({
  getApp: async () => ({ displayName: 'Fixture app', rules: [] }),
  convertToGraphAssignments: (assignments: unknown) => assignments,
  assignToGroups: vi.fn(), syncAppCategories: vi.fn(), setAppRules: vi.fn(),
}));
vi.mock('@/lib/requirement-rules', () => ({ buildCartItemRequirementRules: () => undefined }));
import { GET } from './route';
import { PATCH } from '../../[id]/settings/route';

afterEach(() => vi.clearAllMocks());

describe('hosted deployed config selection', () => {
  it('saves an older selected app without changing another deployment of the same package', async () => {
    const assignments = [{ type: 'allUsers', intent: 'available' }];
    const original = { assignments: [{ type: 'allUsers', intent: 'required' }], description: 'Keep this' };
    const records: Record<string, typeof original> = { 'older-job': structuredClone(original), 'newer-job': structuredClone(original) };
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/tenant_consent')) return Response.json({ id: 'fixture-consent' });
      if (init?.method === 'PATCH') {
        const id = url.searchParams.get('id')?.slice(3) ?? '';
        records[id] = JSON.parse(String(init.body)).package_config;
        return Response.json({ id });
      }
      const id = url.searchParams.get('intune_app_id') === 'eq.older-app' ? 'older-job' : 'newer-job';
      return Response.json({ id, package_config: records[id] });
    });
    const response = await PATCH(new NextRequest('https://website.example.test/api/intune/apps/older-app/settings', {
      method: 'PATCH', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
      body: JSON.stringify({ wingetId: 'Fixture.App', assignments }),
    }), { params: Promise.resolve({ id: 'older-app' }) });
    expect(response.status).toBe(200);
    expect(records['older-job']).toEqual({ ...original, assignments });
    expect(records['newer-job']).toEqual(original);
    const write = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    const query = new URL(String(write![0])).searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      id: 'eq.older-job', user_id: 'eq.fixture-owner', tenant_id: 'eq.fixture-tenant',
      winget_id: 'eq.Fixture.App', intune_app_id: 'eq.older-app', status: 'eq.deployed',
    });
    expect(query.has('archived_at')).toBe(false);
    const lookup = fetchMock.mock.calls.map(([input]) => new URL(String(input)))
      .find(url => url.pathname.endsWith('/packaging_jobs') && url.searchParams.has('order'))!;
    expect(lookup.searchParams.get('intune_app_id')).toBe('eq.older-app');
    expect(lookup.searchParams.get('order')).toBe('completed_at.desc,created_at.desc,id.desc');
    expect(lookup.searchParams.has('archived_at')).toBe(false);
  });

  for (const failure of ['missing', 'raced', 'denied']) {
    it(`reports an unsaved hosted edit after Graph when storage is ${failure}`, async () => {
      fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/tenant_consent')) return Response.json({ id: 'fixture-consent' });
        if (init?.method === 'PATCH') return failure === 'denied'
          ? Response.json({ message: 'Fixture denied', code: '42501' }, { status: 403 }) : Response.json(null);
        return Response.json(failure === 'missing' ? null : { id: 'fixture-job', package_config: { description: 'Keep this' } });
      });
      const response = await PATCH(new NextRequest('https://website.example.test/api/intune/apps/older-app/settings', {
        method: 'PATCH', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
        body: JSON.stringify({ wingetId: 'Fixture.App', assignments: [] }),
      }), { params: Promise.resolve({ id: 'older-app' }) });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain('Intune settings were updated');
    });
  }

  for (const appId of ['older-app', '', null]) {
    it(`filters the selected app without widening owner or tenant scope: ${String(appId)}`, async () => {
      fetchMock.mockResolvedValue(Response.json({ package_config: { description: 'Fixture' }, intune_app_id: 'older-app', completed_at: null }));
      const params = new URLSearchParams({ wingetId: 'Fixture.App' });
      if (appId !== null) params.set('intuneAppId', appId);
      const response = await GET(new NextRequest(`https://website.example.test/api/intune/apps/deployed/config?${params}`));
      expect(response.status).toBe(200);
      const query = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
      expect(query.get('user_id')).toBe('eq.fixture-owner');
      expect(query.get('tenant_id')).toBe('eq.fixture-tenant');
      expect(query.get('winget_id')).toBe('eq.Fixture.App');
      expect(query.get('status')).toBe('eq.deployed');
      expect(query.get('intune_app_id')).toBe(appId === null ? null : `eq.${appId}`);
      expect(query.get('limit')).toBe('1');
    });
  }

  it('returns no config for an unknown app without retrying the latest deployment', async () => {
    fetchMock.mockResolvedValue(Response.json(null));
    const response = await GET(new NextRequest('https://website.example.test/api/intune/apps/deployed/config?wingetId=Fixture.App&intuneAppId=unknown-app'));
    expect(await response.json()).toEqual({ config: null, intuneAppId: null, deployedAt: null });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
