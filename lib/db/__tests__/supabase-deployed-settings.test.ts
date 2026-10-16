import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { createServerClient: () => createClient('https://database.example.test', 'unit-test-only', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchMock },
  }) };
});
import { supabaseDb } from '@/lib/db/supabase-adapter';

afterEach(() => vi.clearAllMocks());

describe('scoped deployed settings query on Supabase', () => {
  it('selects an exact owner, tenant, package and Intune app without a user history cap', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'fixture-job' }));
    expect(await supabaseDb.jobs.getLatestDeployed('fixture-owner', 'fixture-tenant', 'Fixture.App', 'fixture-app'))
      .toEqual({ id: 'fixture-job' });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/rest/v1/packaging_jobs');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      select: '*', user_id: 'eq.fixture-owner', tenant_id: 'eq.fixture-tenant', winget_id: 'eq.Fixture.App',
      status: 'eq.deployed', archived_at: 'is.null', intune_app_id: 'eq.fixture-app',
      order: 'completed_at.desc.nullslast,created_at.desc,id.desc', limit: '1',
    });
  });

  it('allows the config reader to select the latest app within the tenant', async () => {
    fetchMock.mockResolvedValue(Response.json(null));
    expect(await supabaseDb.jobs.getLatestDeployed('fixture-owner', 'fixture-tenant', 'Fixture.App')).toBeNull();
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.has('intune_app_id')).toBe(false);
    expect(url.searchParams.get('tenant_id')).toBe('eq.fixture-tenant');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('propagates a storage failure rather than inventing an absent deployment', async () => {
    fetchMock.mockResolvedValue(Response.json({ message: 'Fixture denied', code: '42501' }, { status: 403 }));
    await expect(supabaseDb.jobs.getLatestDeployed('fixture-owner', 'fixture-tenant', 'Fixture.App'))
      .rejects.toMatchObject({ code: '42501' });
  });
});
