import { describe, it, expect } from 'vitest';
import { resolveTargetTenantId } from './tenant-resolution';

/**
 * Builds a minimal chainable Supabase stub for resolveTargetTenantId. It only
 * needs to answer two query chains, both ending in .single():
 *   from('msp_user_memberships').select(...).eq(...).single()  -> membership
 *   from('msp_managed_tenants').select(...).eq(...)...single()  -> managedTenant
 */
function makeSupabase(opts: {
  membership: unknown;
  managedTenant?: unknown;
}) {
  const results: Record<string, unknown> = {
    msp_user_memberships: opts.membership,
    msp_managed_tenants: opts.managedTenant ?? null,
  };

  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.single = async () => ({ data: results[table] ?? null, error: null });
      return builder;
    },
  } as unknown as Parameters<typeof resolveTargetTenantId>[0]['supabase'];
}

const PRIMARY = 'primary-tenant-id';
const CUSTOMER = 'customer-tenant-id';

const fullMembership = {
  access_mode: 'full',
  msp_organization_id: 'org-1',
  msp_organizations: { primary_tenant_id: PRIMARY },
};
const customerOnlyMembership = {
  access_mode: 'customer_only',
  msp_organization_id: 'org-1',
  msp_organizations: { primary_tenant_id: PRIMARY },
};

describe('resolveTargetTenantId', () => {
  it('allows a full-access member to target the primary tenant via header', async () => {
    const supabase = makeSupabase({
      membership: fullMembership,
      managedTenant: { id: 'mt-1' },
    });
    const result = await resolveTargetTenantId({
      supabase,
      userId: 'u1',
      tokenTenantId: PRIMARY,
      requestedTenantId: PRIMARY,
    });
    expect(result.errorResponse).toBeNull();
    expect(result.tenantId).toBe(PRIMARY);
  });

  it('allows a full-access member to target a granted customer tenant', async () => {
    const supabase = makeSupabase({
      membership: fullMembership,
      managedTenant: { id: 'mt-1' },
    });
    const result = await resolveTargetTenantId({
      supabase,
      userId: 'u1',
      tokenTenantId: PRIMARY,
      requestedTenantId: CUSTOMER,
    });
    expect(result.errorResponse).toBeNull();
    expect(result.tenantId).toBe(CUSTOMER);
  });

  it('rejects a customer-only member targeting the primary tenant via header', async () => {
    const supabase = makeSupabase({
      membership: customerOnlyMembership,
      managedTenant: { id: 'mt-1' },
    });
    const result = await resolveTargetTenantId({
      supabase,
      userId: 'u1',
      tokenTenantId: PRIMARY,
      requestedTenantId: PRIMARY,
    });
    expect(result.errorResponse).not.toBeNull();
    expect(result.errorResponse?.status).toBe(403);
  });

  it('rejects a customer-only member with no header (token tenant is the primary tenant)', async () => {
    const supabase = makeSupabase({ membership: customerOnlyMembership });
    const result = await resolveTargetTenantId({
      supabase,
      userId: 'u1',
      tokenTenantId: PRIMARY,
      requestedTenantId: null,
    });
    expect(result.errorResponse).not.toBeNull();
    expect(result.errorResponse?.status).toBe(403);
  });

  it('allows a customer-only member to target a granted customer tenant', async () => {
    const supabase = makeSupabase({
      membership: customerOnlyMembership,
      managedTenant: { id: 'mt-1' },
    });
    const result = await resolveTargetTenantId({
      supabase,
      userId: 'u1',
      tokenTenantId: PRIMARY,
      requestedTenantId: CUSTOMER,
    });
    expect(result.errorResponse).toBeNull();
    expect(result.tenantId).toBe(CUSTOMER);
  });

  it('rejects a customer-only member targeting an unmanaged tenant', async () => {
    const supabase = makeSupabase({
      membership: customerOnlyMembership,
      managedTenant: null,
    });
    const result = await resolveTargetTenantId({
      supabase,
      userId: 'u1',
      tokenTenantId: PRIMARY,
      requestedTenantId: 'some-other-tenant',
    });
    expect(result.errorResponse).not.toBeNull();
    expect(result.errorResponse?.status).toBe(403);
  });

  it('returns the token tenant unchanged for a non-MSP user with no header', async () => {
    const supabase = makeSupabase({ membership: null });
    const result = await resolveTargetTenantId({
      supabase,
      userId: 'u1',
      tokenTenantId: 'solo-tenant',
      requestedTenantId: null,
    });
    expect(result.errorResponse).toBeNull();
    expect(result.tenantId).toBe('solo-tenant');
  });

  it('rejects a non-MSP user trying to target a different tenant', async () => {
    const supabase = makeSupabase({ membership: null });
    const result = await resolveTargetTenantId({
      supabase,
      userId: 'u1',
      tokenTenantId: 'solo-tenant',
      requestedTenantId: 'other-tenant',
    });
    expect(result.errorResponse).not.toBeNull();
    expect(result.errorResponse?.status).toBe(403);
  });
});

describe('resolveTargetTenantId role enforcement in customer tenants', () => {
  const withRole = (role: string | null | undefined) => ({ ...fullMembership, role });
  const target = (role: string | null | undefined, requiredPermission?: 'deploy_apps' | 'manage_policies' | 'view_dashboard') =>
    resolveTargetTenantId({
      supabase: makeSupabase({ membership: withRole(role), managedTenant: { id: 'mt-1' } }),
      userId: 'u1',
      tokenTenantId: PRIMARY,
      requestedTenantId: CUSTOMER,
      requiredPermission,
    });

  it.each([
    ['viewer', 'deploy_apps', 403],
    ['viewer', 'manage_policies', 403],
    ['operator', 'deploy_apps', 200],
    ['operator', 'manage_policies', 403],
    ['admin', 'deploy_apps', 200],
    ['admin', 'manage_policies', 200],
    ['owner', 'manage_policies', 200],
  ] as const)('%s asking for %s gets %i', async (role, permission, status) => {
    const result = await target(role, permission);
    if (status === 200) {
      expect(result.errorResponse).toBeNull();
      expect(result.tenantId).toBe(CUSTOMER);
      expect(result.mspRole).toBe(role);
    } else {
      expect(result.errorResponse?.status).toBe(403);
      // A denied caller must never be handed the customer tenant id to act on.
      expect(result.tenantId).toBe(PRIMARY);
      expect(await result.errorResponse?.json()).toMatchObject({ required_permission: permission });
    }
  });

  it.each([null, undefined, '', 'superuser'])('treats the role %j as viewer', async (role) => {
    expect((await target(role, 'deploy_apps')).errorResponse?.status).toBe(403);
    expect((await target(role, 'view_dashboard')).errorResponse).toBeNull();
  });

  it('keeps read routes open to every role when no permission is required', async () => {
    const result = await target('viewer');
    expect(result.errorResponse).toBeNull();
    expect(result.tenantId).toBe(CUSTOMER);
  });

  it("does not apply the MSP role to work in the caller's own tenant", async () => {
    const result = await resolveTargetTenantId({
      supabase: makeSupabase({ membership: withRole('viewer') }),
      userId: 'u1',
      tokenTenantId: PRIMARY,
      requestedTenantId: null,
      requiredPermission: 'deploy_apps',
    });
    expect(result.errorResponse).toBeNull();
    expect(result.tenantId).toBe(PRIMARY);
  });

  it('checks tenant access before the role, so an unmanaged tenant is refused for every role', async () => {
    const result = await resolveTargetTenantId({
      supabase: makeSupabase({ membership: withRole('owner'), managedTenant: null }),
      userId: 'u1',
      tokenTenantId: PRIMARY,
      requestedTenantId: 'unmanaged-tenant',
      requiredPermission: 'deploy_apps',
    });
    expect(result.errorResponse?.status).toBe(403);
    expect(result.tenantId).toBe(PRIMARY);
  });
});
