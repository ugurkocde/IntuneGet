/**
 * Customer approval of an MSP link.
 *
 * Microsoft's admin consent redirect carries `tenant` and `admin_consent` as
 * plain query parameters. They are not signed, and the consent itself only
 * says "this tenant allows the IntuneGet app", which is true for every tenant
 * that already uses IntuneGet. Neither is proof that an administrator of that
 * tenant agreed to be managed by a particular MSP.
 *
 * The proof used here is a signed-in administrator of the customer tenant who
 * explicitly approves the named MSP. The tenant that gets linked is always the
 * tenant of that verified sign-in, never a value from a URL.
 */

import type { createServerClient } from '@/lib/supabase';
import type { TokenUserInfo } from '@/lib/auth-utils';
import type { ConsentStatus } from '@/types/msp';
import { verifyConsentState } from '@/lib/auth-utils';
import { acquireConsentToken } from '@/lib/consent-token';
import {
  TENANT_APPROVER_ROLES,
  hasAnyDirectoryRole,
  resolveDirectoryRoles,
} from '@/lib/auth/directory-roles';
import { createAuditLog } from '@/lib/audit-logger';
import { logConsentStatus, logPermissions, logTokenAcquired } from '@/lib/permission-logger';

type Supabase = ReturnType<typeof createServerClient>;

const ROUTE = '/api/msp/tenants/consent-approval';
const REQUIRED_APP_ROLE = 'DeviceManagementApps.ReadWrite.All';
const APPROVABLE_STATUSES: ConsentStatus[] = ['pending', 'consent_incomplete'];
const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConsentApprovalErrorCode =
  | 'invalid_state'
  | 'request_not_found'
  | 'request_closed'
  | 'own_tenant'
  | 'tenant_mismatch'
  | 'not_administrator'
  | 'role_unknown'
  | 'update_failed';

export interface ConsentApprovalRequest {
  recordId: string;
  organizationId: string;
  organizationName: string;
  /** Tenant of the MSP itself. A sign-in from it cannot approve. */
  primaryTenantId: string;
  /** Set when an earlier approval already bound the record to a tenant. */
  boundTenantId: string | null;
  addedByUserId: string;
  /**
   * Sign-in name of the MSP member who created the request. The organization
   * name is chosen by the MSP itself, so the approver also gets to see who is
   * asking and from which domain.
   */
  requestedByEmail: string | null;
}

export type LoadRequestResult =
  | { ok: true; request: ConsentApprovalRequest }
  | { ok: false; code: ConsentApprovalErrorCode };

interface TenantRecordRow {
  id: string;
  msp_organization_id: string;
  tenant_id: string | null;
  consent_status: string;
  is_active: boolean;
  added_by_user_id: string;
  msp_organizations: { name: string; primary_tenant_id: string; is_active: boolean; created_by_email?: string | null };
}

/**
 * Resolve a signed state to the pending link request it belongs to.
 */
export async function loadApprovalRequest(supabase: Supabase, state: string | null): Promise<LoadRequestResult> {
  const parsed = state ? verifyConsentState(state) : null;
  if (!parsed) {
    return { ok: false, code: 'invalid_state' };
  }

  const { data } = await supabase
    .from('msp_managed_tenants')
    .select(
      'id, msp_organization_id, tenant_id, consent_status, is_active, added_by_user_id, msp_organizations!inner(name, primary_tenant_id, is_active, created_by_email)'
    )
    .eq('id', parsed.tenantRecordId)
    .eq('msp_organization_id', parsed.mspOrgId)
    .single();

  const record = data as unknown as TenantRecordRow | null;
  if (!record || !record.is_active || !record.msp_organizations?.is_active) {
    return { ok: false, code: 'request_not_found' };
  }

  // A granted or revoked record cannot be approved again with an old link.
  if (!APPROVABLE_STATUSES.includes(record.consent_status as ConsentStatus)) {
    return { ok: false, code: 'request_closed' };
  }

  // Who created the request. A member who has since left falls back to the
  // organization's creator.
  const { data: requester } = await supabase
    .from('msp_user_memberships')
    .select('user_email')
    .eq('msp_organization_id', record.msp_organization_id)
    .eq('user_id', record.added_by_user_id)
    .maybeSingle();

  return {
    ok: true,
    request: {
      recordId: record.id,
      organizationId: record.msp_organization_id,
      organizationName: record.msp_organizations.name,
      primaryTenantId: record.msp_organizations.primary_tenant_id,
      boundTenantId: record.tenant_id,
      addedByUserId: record.added_by_user_id,
      requestedByEmail:
        (requester as { user_email?: string | null } | null)?.user_email ||
        record.msp_organizations.created_by_email ||
        null,
    },
  };
}

export type ApproverCheck =
  | { ok: true; roles: string[] }
  | { ok: false; code: ConsentApprovalErrorCode };

/**
 * Decide whether the signed-in user may approve this request for their tenant.
 */
export async function checkApprover(
  request: ConsentApprovalRequest,
  user: TokenUserInfo,
  authHeader: string | null
): Promise<ApproverCheck> {
  if (!TENANT_ID_PATTERN.test(user.tenantId)) {
    return { ok: false, code: 'tenant_mismatch' };
  }

  // The MSP's own staff sign in from the MSP's tenant. They are the party
  // asking for access, so they can never be the party granting it.
  if (user.tenantId.toLowerCase() === request.primaryTenantId.toLowerCase()) {
    return { ok: false, code: 'own_tenant' };
  }

  if (request.boundTenantId && request.boundTenantId.toLowerCase() !== user.tenantId.toLowerCase()) {
    return { ok: false, code: 'tenant_mismatch' };
  }

  const roles = await resolveDirectoryRoles(user, authHeader);
  if (roles === null) {
    return { ok: false, code: 'role_unknown' };
  }
  if (!hasAnyDirectoryRole(roles, TENANT_APPROVER_ROLES)) {
    return { ok: false, code: 'not_administrator' };
  }

  return { ok: true, roles };
}

export type ApprovalOutcome =
  | { ok: true; status: 'granted' | 'already_managed' | 'permissions_incomplete' }
  | { ok: false; code: ConsentApprovalErrorCode };

/**
 * Link the approver's tenant to the MSP. Call only after checkApprover passed.
 */
export async function approveLink(
  supabase: Supabase,
  request: ConsentApprovalRequest,
  user: TokenUserInfo,
  meta: { ip_address?: string; user_agent?: string } = {}
): Promise<ApprovalOutcome> {
  const tenantId = user.tenantId.toLowerCase();
  const now = new Date().toISOString();

  // The same customer may already be linked through another record.
  const { data: existing } = await supabase
    .from('msp_managed_tenants')
    .select('id')
    .eq('msp_organization_id', request.organizationId)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .neq('id', request.recordId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('msp_managed_tenants')
      .delete()
      .eq('id', request.recordId)
      .in('consent_status', APPROVABLE_STATUSES);
    return { ok: true, status: 'already_managed' };
  }

  // Verify the app permission first. The record only becomes 'granted' after
  // this check passed, so there is no window in which an unverified tenant is
  // deployable.
  //
  // When the permission is not there yet (Microsoft can take a few minutes
  // after consent) nothing is written and the request stays open, so the
  // administrator can simply approve again. The database only knows the
  // statuses pending, granted and revoked.
  if (!(await verifyAppPermission(tenantId))) {
    return { ok: true, status: 'permissions_incomplete' };
  }

  // A customer that was removed earlier still holds the unique
  // (organization, tenant) slot on its inactive record. Release it, or the
  // customer could never be linked again.
  await supabase
    .from('msp_managed_tenants')
    .update({ tenant_id: null, updated_at: now })
    .eq('msp_organization_id', request.organizationId)
    .eq('tenant_id', tenantId)
    .eq('is_active', false)
    .neq('id', request.recordId);

  const { data: updated, error: updateError } = await supabase
    .from('msp_managed_tenants')
    .update({
      tenant_id: tenantId,
      consent_status: 'granted',
      consent_granted_at: now,
      consented_by_email: user.userEmail,
      updated_at: now,
    })
    .eq('id', request.recordId)
    .eq('msp_organization_id', request.organizationId)
    .eq('is_active', true)
    .in('consent_status', APPROVABLE_STATUSES)
    .select('id');

  if (updateError || !updated || updated.length === 0) {
    return { ok: false, code: updateError ? 'update_failed' : 'request_closed' };
  }

  await recordTenantConsent(supabase, tenantId, user.userId, now);

  await createAuditLog({
    organization_id: request.organizationId,
    user_id: user.userId,
    user_email: user.userEmail,
    action: 'tenant.consent_granted',
    resource_type: 'tenant',
    resource_id: request.recordId,
    details: { tenant_id: tenantId, approved_by: user.userEmail, approval: 'signed_in_administrator' },
    ...meta,
  });

  logConsentStatus(ROUTE, tenantId, 'granted', [REQUIRED_APP_ROLE], { tenantRecordId: request.recordId });

  return { ok: true, status: 'granted' };
}

async function verifyAppPermission(tenantId: string): Promise<boolean> {
  const tokenResult = await acquireConsentToken(tenantId);

  if (!tokenResult.ok) {
    logPermissions({
      route: ROUTE,
      action: 'token_acquisition_failed',
      tenantId,
      granted: false,
      error: tokenResult.error,
      details: { errorCode: tokenResult.errorCode, errorDescription: tokenResult.errorDescription },
    });
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(tokenResult.accessToken.split('.')[1], 'base64').toString());
    const roles: string[] = Array.isArray(payload.roles) ? payload.roles : [];
    logTokenAcquired(ROUTE, tenantId, roles);

    if (roles.includes(REQUIRED_APP_ROLE)) {
      return true;
    }
    logConsentStatus(ROUTE, tenantId, 'incomplete', roles, { reason: 'missing_intune_permission' });
    return false;
  } catch (error) {
    logPermissions({
      route: ROUTE,
      action: 'permission_verification_error',
      tenantId,
      granted: false,
      error: 'verification_exception',
      details: { error: String(error) },
    });
    return false;
  }
}

/**
 * Keep the tenant_consent cache in step. An existing row belongs to a tenant
 * that already uses IntuneGet directly, so its consent details are left as
 * they are and only a deactivated row is switched back on.
 */
async function recordTenantConsent(supabase: Supabase, tenantId: string, userId: string, now: string): Promise<void> {
  const { data: existing } = await supabase
    .from('tenant_consent')
    .select('tenant_id, is_active')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!existing) {
    await supabase.from('tenant_consent').insert({
      tenant_id: tenantId,
      tenant_name: null,
      consented_by_user_id: userId,
      consent_granted_at: now,
      is_active: true,
    });
    return;
  }

  if (!existing.is_active) {
    await supabase.from('tenant_consent').update({ is_active: true }).eq('tenant_id', tenantId);
  }
}
