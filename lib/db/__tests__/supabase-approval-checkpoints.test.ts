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
