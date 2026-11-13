/**
 * What has to stop when MSP access ends.
 *
 * Removing a customer tenant or a team member only changed what the portal
 * showed. Update policies that MSP members had created for a customer tenant
 * stayed enabled, so the nightly update check kept deploying into a tenant
 * the MSP (or that member) no longer manages. These helpers switch those
 * policies off. They never touch policies of the customer's own users.
 */

import type { createServerClient } from '@/lib/supabase';

type Supabase = ReturnType<typeof createServerClient>;

async function disablePolicies(supabase: Supabase, userIds: string[], tenantIds: string[]): Promise<number> {
  if (userIds.length === 0 || tenantIds.length === 0) return 0;

  const { data, error } = await supabase
    .from('app_update_policies')
    .update({ is_enabled: false, updated_at: new Date().toISOString() })
    .in('user_id', userIds)
    .in('tenant_id', tenantIds)
    .eq('is_enabled', true)
    .select('id');

  if (error) {
    console.error('Failed to disable update policies after MSP access ended:', error.message);
    return 0;
  }
  return data?.length ?? 0;
}

const LOOKUP_CHUNK = 40;

function chunks<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += LOOKUP_CHUNK) out.push(values.slice(i, i + LOOKUP_CHUNK));
  return out;
}

interface MembershipRow {
  user_id: string;
  msp_organization_id: string;
  user_tenant_id: string | null;
  msp_organizations: { primary_tenant_id: string } | null;
}

export interface PolicyAccessResult<T> {
  allowed: T[];
  /** Policies whose owner cannot act in the policy's tenant today. */
  denied: T[];
  /** Set when access could not be checked. Every policy is then denied for this run. */
  error?: string;
}

/**
 * Keep only the policies whose owner may still act in the policy's tenant.
 *
 * A stored policy is not proof of access: the link to a customer may have
 * been removed, or deactivated directly in the database, after the policy was
 * created. Automation that runs without a signed-in user (the nightly update
 * check) has to ask again.
 *
 * A member of an MSP organization may act in the organization's own tenant
 * and in customer tenants with an active, granted link. A user without a
 * membership only works in their own tenant, and their policies pass.
 */
export async function filterPoliciesByCurrentAccess<T extends { user_id: string; tenant_id: string }>(
  supabase: Supabase,
  policies: T[]
): Promise<PolicyAccessResult<T>> {
  if (policies.length === 0) return { allowed: [], denied: [] };

  const memberships = new Map<string, { org: string; home: string | null }>();
  for (const userIds of chunks([...new Set(policies.map((policy) => policy.user_id))])) {
    const { data, error } = await supabase
      .from('msp_user_memberships')
      .select('user_id, msp_organization_id, user_tenant_id, msp_organizations!inner(primary_tenant_id)')
      .in('user_id', userIds);
    if (error) {
      return { allowed: [], denied: policies, error: `Could not check MSP memberships: ${error.message}` };
    }
    for (const row of (data || []) as unknown as MembershipRow[]) {
      memberships.set(row.user_id, {
        org: row.msp_organization_id,
        home: row.user_tenant_id || row.msp_organizations?.primary_tenant_id || null,
      });
    }
  }

  // Tenants that are not the member's own need an active, granted link.
  const needsLink = policies.filter((policy) => {
    const membership = memberships.get(policy.user_id);
    return membership && policy.tenant_id !== membership.home;
  });

  const links = new Set<string>();
  for (const tenantIds of chunks([...new Set(needsLink.map((policy) => policy.tenant_id))])) {
    const { data, error } = await supabase
      .from('msp_managed_tenants')
      .select('msp_organization_id, tenant_id')
      .in('tenant_id', tenantIds)
      .eq('consent_status', 'granted')
      .eq('is_active', true);
    if (error) {
      return { allowed: [], denied: policies, error: `Could not check MSP tenant links: ${error.message}` };
    }
    for (const row of (data || []) as Array<{ msp_organization_id: string; tenant_id: string }>) {
      links.add(`${row.msp_organization_id}:${row.tenant_id}`);
    }
  }

  const allowed: T[] = [];
  const denied: T[] = [];
  for (const policy of policies) {
    const membership = memberships.get(policy.user_id);
    const ok =
      !membership ||
      policy.tenant_id === membership.home ||
      links.has(`${membership.org}:${policy.tenant_id}`);
    (ok ? allowed : denied).push(policy);
  }
  return { allowed, denied };
}

/**
 * A customer tenant was removed from an MSP organization: switch off the
 * policies its members hold for that tenant. Skipped when another active
 * record of the same organization still manages the tenant.
 */
export async function disablePoliciesForRemovedTenant(
  supabase: Supabase,
  organizationId: string,
  tenantId: string | null
): Promise<number> {
  if (!tenantId) return 0;

  const { data: stillManaged } = await supabase
    .from('msp_managed_tenants')
    .select('id')
    .eq('msp_organization_id', organizationId)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .limit(1);
  if (stillManaged && stillManaged.length > 0) return 0;

  const { data: members } = await supabase
    .from('msp_user_memberships')
    .select('user_id')
    .eq('msp_organization_id', organizationId);

  const userIds = (members || []).map((member: { user_id: string }) => member.user_id);
  return disablePolicies(supabase, userIds, [tenantId]);
}

/**
 * A member left an MSP organization: switch off the policies that member
 * holds for the organization's customer tenants. Policies for the MSP's own
 * tenant stay, because the person is still a user of that tenant.
 */
export async function disablePoliciesForRemovedMember(
  supabase: Supabase,
  organizationId: string,
  userId: string,
  primaryTenantId: string | null
): Promise<number> {
  const { data: tenants } = await supabase
    .from('msp_managed_tenants')
    .select('tenant_id')
    .eq('msp_organization_id', organizationId)
    .eq('is_active', true);

  const tenantIds = (tenants || [])
    .map((tenant: { tenant_id: string | null }) => tenant.tenant_id)
    .filter((tenantId): tenantId is string => Boolean(tenantId) && tenantId !== primaryTenantId);

  return disablePolicies(supabase, [userId], [...new Set(tenantIds)]);
}
