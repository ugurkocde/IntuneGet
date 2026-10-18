import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const { auth, client } = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: auth }));
vi.mock('@/lib/supabase', () => ({ createServerClient: client }));
import { GET } from './route';
function query(result: unknown) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'not', 'in', 'order', 'range']) q[method] = vi.fn(() => q);
  q.single = vi.fn(async () => result);
  q.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve));
  return q;
}
describe('MSP upstream reason projection', () => {
  beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ userId: 'fake-user' }); });
  it.each(['UPSTREAM_SOURCE_BACKOFF', 'UPSTREAM_METADATA_MISMATCH', 'https://private.invalid/opaque'])('returns only an allowlisted reason within the managed tenant scope: %s', async code => {
    const membership = query({ data: { msp_organization_id: 'fake-org', access_mode: 'customer_only',
      msp_organizations: { is_active: true, primary_tenant_id: 'fake-primary' } } });
    const tenants = query({ data: [{ tenant_id: 'fake-customer', display_name: 'Customer' }, { tenant_id: 'fake-primary', display_name: 'Primary' }] });
    const jobs = query({ data: [{ id: 'fake-job', tenant_id: 'fake-customer', status: 'blocked_upstream', error_code: code }], count: 1, error: null });
    client.mockReturnValue({ from: vi.fn(table => table === 'msp_user_memberships' ? membership : table === 'msp_managed_tenants' ? tenants : jobs) });
    const response = await GET(new NextRequest('https://example.test/api/msp/jobs'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs[0].error_code).toBe(code.startsWith('UPSTREAM_') ? code : null);
    expect(jobs.in).toHaveBeenCalledWith('tenant_id', ['fake-customer']);
    expect(membership.eq).toHaveBeenCalledWith('user_id', 'fake-user');
    expect(tenants.eq).toHaveBeenCalledWith('msp_organization_id', 'fake-org');
  });
  it('rejects unauthenticated requests before reading jobs', async () => {
    auth.mockResolvedValue(null);
    expect((await GET(new NextRequest('https://example.test/api/msp/jobs'))).status).toBe(401);
    expect(client).not.toHaveBeenCalled();
  });
});
