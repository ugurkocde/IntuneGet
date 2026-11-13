import { describe, expect, it } from 'vitest';
import {
  disablePoliciesForRemovedMember,
  disablePoliciesForRemovedTenant,
  filterPoliciesByCurrentAccess,
} from './revocation';
import { createFakeSupabase } from './test-support/fake-supabase';

type Supabase = Parameters<typeof disablePoliciesForRemovedTenant>[0];

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const PRIMARY = 'primary-tenant';
const CUSTOMER_A = 'customer-a';
const CUSTOMER_B = 'customer-b';

function world() {
  return createFakeSupabase({
    msp_user_memberships: [
      { user_id: 'alice', msp_organization_id: ORG },
      { user_id: 'bob', msp_organization_id: ORG },
      { user_id: 'mallory', msp_organization_id: OTHER_ORG },
    ],
    msp_managed_tenants: [
      { id: 'self', msp_organization_id: ORG, tenant_id: PRIMARY, is_active: true },
      { id: 'a', msp_organization_id: ORG, tenant_id: CUSTOMER_A, is_active: true },
      { id: 'b', msp_organization_id: ORG, tenant_id: CUSTOMER_B, is_active: true },
      { id: 'pending', msp_organization_id: ORG, tenant_id: null, is_active: true },
      { id: 'other-org-a', msp_organization_id: OTHER_ORG, tenant_id: CUSTOMER_A, is_active: true },
    ],
    app_update_policies: [
      { id: 'alice-a', user_id: 'alice', tenant_id: CUSTOMER_A, is_enabled: true },
      { id: 'alice-b', user_id: 'alice', tenant_id: CUSTOMER_B, is_enabled: true },
      { id: 'alice-own', user_id: 'alice', tenant_id: PRIMARY, is_enabled: true },
      { id: 'bob-a', user_id: 'bob', tenant_id: CUSTOMER_A, is_enabled: true },
      { id: 'bob-a-off', user_id: 'bob', tenant_id: CUSTOMER_A, is_enabled: false },
      // Another MSP that also manages customer A.
      { id: 'mallory-a', user_id: 'mallory', tenant_id: CUSTOMER_A, is_enabled: true },
      // The customer's own administrator.
      { id: 'customer-a-own', user_id: 'customer-admin', tenant_id: CUSTOMER_A, is_enabled: true },
    ],
  });
}

const enabled = (db: ReturnType<typeof world>) =>
  db.tables.app_update_policies.filter((policy) => policy.is_enabled).map((policy) => policy.id).sort();

describe('filterPoliciesByCurrentAccess', () => {
  const access = () =>
    createFakeSupabase({
      msp_user_memberships: [
        { user_id: 'alice', msp_organization_id: ORG, user_tenant_id: PRIMARY, msp_organizations: { primary_tenant_id: PRIMARY } },
        // Older rows may lack the member's own tenant: the organization's tenant is used.
        { user_id: 'bob', msp_organization_id: ORG, user_tenant_id: null, msp_organizations: { primary_tenant_id: PRIMARY } },
        { user_id: 'mallory', msp_organization_id: OTHER_ORG, user_tenant_id: 'mallory-home', msp_organizations: { primary_tenant_id: 'mallory-home' } },
      ],
      msp_managed_tenants: [
        { msp_organization_id: ORG, tenant_id: CUSTOMER_A, consent_status: 'granted', is_active: true },
        { msp_organization_id: ORG, tenant_id: CUSTOMER_B, consent_status: 'granted', is_active: false },
        { msp_organization_id: OTHER_ORG, tenant_id: CUSTOMER_B, consent_status: 'granted', is_active: true },
      ],
    });

  const p = (id: string, user_id: string, tenant_id: string) => ({ id, user_id, tenant_id });

  it('allows own-tenant work and active links, and denies everything else', async () => {
    const db = access();
    const result = await filterPoliciesByCurrentAccess(db.client as unknown as Supabase, [
      p('own', 'alice', PRIMARY),
      p('own-via-org', 'bob', PRIMARY),
      p('active-link', 'alice', CUSTOMER_A),
      p('removed-link', 'alice', CUSTOMER_B),
      p('never-linked', 'bob', 'somebody-else'),
      p('other-org-link', 'mallory', CUSTOMER_B),
      p('other-org-no-link', 'mallory', CUSTOMER_A),
      p('single-tenant-user', 'customer-admin', CUSTOMER_A),
    ]);

    expect(result.error).toBeUndefined();
    expect(result.allowed.map((policy) => policy.id)).toEqual(['own', 'own-via-org', 'active-link', 'other-org-link', 'single-tenant-user']);
    expect(result.denied.map((policy) => policy.id)).toEqual(['removed-link', 'never-linked', 'other-org-no-link']);
    expect(db.writes).toEqual([]);
  });

  it('handles more users and tenants than fit in one lookup', async () => {
    const db = access();
    for (let i = 0; i < 95; i++) {
      db.tables.msp_user_memberships.push({ user_id: `u${i}`, msp_organization_id: ORG, user_tenant_id: PRIMARY, msp_organizations: { primary_tenant_id: PRIMARY } });
      if (i % 2 === 0) db.tables.msp_managed_tenants.push({ msp_organization_id: ORG, tenant_id: `t${i}`, consent_status: 'granted', is_active: true });
    }
    const policies = Array.from({ length: 95 }, (_, i) => p(`p${i}`, `u${i}`, `t${i}`));

    const result = await filterPoliciesByCurrentAccess(db.client as unknown as Supabase, policies);

    expect(result.allowed).toHaveLength(48);
    expect(result.denied).toHaveLength(47);
    expect(result.allowed.every((policy) => Number(policy.id.slice(1)) % 2 === 0)).toBe(true);
  });

  it('denies every policy for the run when access cannot be checked', async () => {
    const failing = {
      from: () => {
        const q = { select: () => q, in: () => q, eq: () => q, then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'timeout' } }).then(resolve) };
        return q;
      },
    };
    const policies = [p('a', 'alice', CUSTOMER_A)];

    const result = await filterPoliciesByCurrentAccess(failing as unknown as Supabase, policies);

    expect(result.allowed).toEqual([]);
    expect(result.denied).toEqual(policies);
    expect(result.error).toContain('timeout');
  });

  it('returns quickly for an empty list', async () => {
    const db = access();
    expect(await filterPoliciesByCurrentAccess(db.client as unknown as Supabase, [])).toEqual({ allowed: [], denied: [] });
  });
});

describe('disablePoliciesForRemovedTenant', () => {
  it("switches off the team's policies for the removed tenant only", async () => {
    const db = world();
    // The route soft-deletes the record before it calls the helper.
    db.tables.msp_managed_tenants[1].is_active = false;

    const count = await disablePoliciesForRemovedTenant(db.client as unknown as Supabase, ORG, CUSTOMER_A);

    expect(count).toBe(2);
    expect(enabled(db)).toEqual(['alice-b', 'alice-own', 'customer-a-own', 'mallory-a']);
  });

  it('does nothing while another active record of the same organization still manages the tenant', async () => {
    const db = world();
    const count = await disablePoliciesForRemovedTenant(db.client as unknown as Supabase, ORG, CUSTOMER_A);
    expect(count).toBe(0);
    expect(db.writes).toEqual([]);
  });

  it('does nothing for a record that never had a tenant', async () => {
    const db = world();
    expect(await disablePoliciesForRemovedTenant(db.client as unknown as Supabase, ORG, null)).toBe(0);
    expect(db.writes).toEqual([]);
  });
});

describe('disablePoliciesForRemovedMember', () => {
  it("switches off the member's policies for customer tenants and keeps those for their own tenant", async () => {
    const db = world();

    const count = await disablePoliciesForRemovedMember(db.client as unknown as Supabase, ORG, 'alice', PRIMARY);

    expect(count).toBe(2);
    expect(enabled(db)).toEqual(['alice-own', 'bob-a', 'customer-a-own', 'mallory-a']);
  });

  it('leaves everything alone for a member without customer policies', async () => {
    const db = world();
    expect(await disablePoliciesForRemovedMember(db.client as unknown as Supabase, ORG, 'nobody', PRIMARY)).toBe(0);
    expect(enabled(db)).toHaveLength(6);
  });
});
