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
import { GET } from './route';

afterEach(() => vi.clearAllMocks());

describe('hosted deployed config selection', () => {
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
