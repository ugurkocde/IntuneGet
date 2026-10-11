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
describe('Supabase approval checkpoint wire query', () => {
  it('uses literal case-insensitive curated matching on cursor pages without dropping filters', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    const cursor = { createdAt: '2026-10-07T00:00:00Z', id: '11111111-1111-1111-1111-111111111111' };
    await supabaseDb.jobs.getApprovalFailures('tenant-fixture', 'IntuneGet.Curated.Fixture', cursor);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('winget_id')).toBe('ilike.IntuneGet.Curated.Fixture');
    expect(url.searchParams.get('tenant_id')).toBe('eq.tenant-fixture');
    expect(url.searchParams.get('status')).toBe('in.(failed,cancelled)');
    expect(url.searchParams.getAll('or')).toEqual([
      '(error_category.eq.approval,error_code.eq.INTUNE_APPROVAL_REQUIRED)',
      `(created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}))`,
    ]);
  });
  it.each(['%', '_', '*', '\\', 'é'])('rejects curated wildcard or non-ASCII input %s before requesting data', async suffix => {
    await expect(supabaseDb.jobs.getApprovalFailures('tenant-fixture', `IntuneGet.Curated.${suffix}`))
      .rejects.toThrow('Invalid curated approval checkpoint ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('includes failed and cancelled status while retaining tenant, package and approval filters', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ id: 'checkpoint', status: 'cancelled' }]), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const rows = await supabaseDb.jobs.getApprovalFailures('tenant-fixture', 'Vendor.App');
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/rest/v1/packaging_jobs');
    expect(url.searchParams.get('tenant_id')).toBe('eq.tenant-fixture');
    expect(url.searchParams.get('winget_id')).toBe('eq.Vendor.App');
    expect(url.searchParams.get('status')).toBe('in.(failed,cancelled)');
    expect(url.searchParams.get('or')).toBe('(error_category.eq.approval,error_code.eq.INTUNE_APPROVAL_REQUIRED)');
    expect(rows).toMatchObject([{ status: 'cancelled' }]);
  });
});
