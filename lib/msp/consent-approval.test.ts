import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { acquireConsentToken, createAuditLog } = vi.hoisted(() => ({
  acquireConsentToken: vi.fn(),
  createAuditLog: vi.fn(async () => {}),
}));
vi.mock('@/lib/consent-token', () => ({ acquireConsentToken }));
vi.mock('@/lib/audit-logger', () => ({ createAuditLog }));
vi.mock('@/lib/permission-logger', () => ({
  logConsentStatus: vi.fn(),
  logPermissions: vi.fn(),
  logTokenAcquired: vi.fn(),
}));

import { signConsentState, type TokenUserInfo } from '@/lib/auth-utils';
import {
  GLOBAL_ADMINISTRATOR_ROLE,
  INTUNE_ADMINISTRATOR_ROLE,
  PRIVILEGED_ROLE_ADMINISTRATOR_ROLE,
} from '@/lib/auth/directory-roles';
import { approveLink, checkApprover, loadApprovalRequest, type ConsentApprovalRequest } from './consent-approval';
import { createFakeSupabase } from './test-support/fake-supabase';

type Supabase = Parameters<typeof loadApprovalRequest>[0];

const ORG = '55555555-aaaa-4bbb-8ccc-666666666666';
const RECORD = '77777777-aaaa-4bbb-8ccc-888888888888';
const MSP_TENANT = 'aaaaaaaa-0000-4000-8000-000000000001';
const CUSTOMER_TENANT = 'bbbbbbbb-0000-4000-8000-000000000002';
const OTHER_TENANT = 'cccccccc-0000-4000-8000-000000000003';

function appToken(roles: string[]) {
  const payload = Buffer.from(JSON.stringify({ roles })).toString('base64');
  return { ok: true as const, accessToken: `header.${payload}.signature` };
}

function world(recordOverrides: Record<string, unknown> = {}, extraTenantRows: Record<string, unknown>[] = []) {
  return createFakeSupabase({
    msp_managed_tenants: [
      {
        id: RECORD,
        msp_organization_id: ORG,
        tenant_id: null,
        consent_status: 'pending',
        is_active: true,
        added_by_user_id: 'msp-user',
        msp_organizations: { name: 'Northwind MSP', primary_tenant_id: MSP_TENANT, is_active: true },
        ...recordOverrides,
      },
      ...extraTenantRows,
    ],
    tenant_consent: [],
  });
}

function user(tenantId: string, directoryRoles: string[] | undefined): TokenUserInfo {
  return { userId: 'approver-1', userEmail: 'admin@customer.example', tenantId, userName: 'Admin', directoryRoles };
}

async function openRequest(db: ReturnType<typeof world>): Promise<ConsentApprovalRequest> {
  const loaded = await loadApprovalRequest(db.client as unknown as Supabase, signConsentState(ORG, RECORD));
  if (!loaded.ok) throw new Error(`request did not load: ${loaded.code}`);
  return loaded.request;
}

beforeEach(() => {
  vi.stubEnv('MSP_STATE_SECRET', 'unit-test-secret');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  acquireConsentToken.mockReset();
  createAuditLog.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadApprovalRequest', () => {
  it('loads an open request with the name of the MSP', async () => {
    const request = await openRequest(world());
    expect(request).toMatchObject({ recordId: RECORD, organizationName: 'Northwind MSP', primaryTenantId: MSP_TENANT });
  });

  it('names the member who asked, so the approver does not rely on a name the MSP chose', async () => {
    const db = world();
    db.tables.msp_user_memberships = [
      { msp_organization_id: ORG, user_id: 'msp-user', user_email: 'tech@northwind.example' },
      { msp_organization_id: 'another-org', user_id: 'msp-user', user_email: 'wrong@elsewhere.example' },
    ];
    expect((await openRequest(db)).requestedByEmail).toBe('tech@northwind.example');
  });

  it('falls back to the creator of the organization when the member has left', async () => {
    const db = world({
      msp_organizations: { name: 'Northwind MSP', primary_tenant_id: MSP_TENANT, is_active: true, created_by_email: 'owner@northwind.example' },
    });
    expect((await openRequest(db)).requestedByEmail).toBe('owner@northwind.example');
    expect((await openRequest(world())).requestedByEmail).toBeNull();
  });

  it('rejects a missing, forged or foreign state', async () => {
    const db = world();
    const client = db.client as unknown as Supabase;
    expect(await loadApprovalRequest(client, null)).toEqual({ ok: false, code: 'invalid_state' });
    expect(await loadApprovalRequest(client, `${ORG}:${RECORD}:${Date.now()}:deadbeef`)).toEqual({ ok: false, code: 'invalid_state' });
    // Correctly signed, but for a record of another organization.
    expect(await loadApprovalRequest(client, signConsentState('99999999-aaaa-4bbb-8ccc-000000000000', RECORD))).toEqual({
      ok: false,
      code: 'request_not_found',
    });
  });

  it.each([
    ['granted', 'request_closed'],
    ['revoked', 'request_closed'],
  ])('does not reopen a %s record with an old link', async (status, code) => {
    const db = world({ consent_status: status });
    expect(await loadApprovalRequest(db.client as unknown as Supabase, signConsentState(ORG, RECORD))).toEqual({ ok: false, code });
  });

  it('rejects a removed record and a deactivated organization', async () => {
    const removed = world({ is_active: false });
    expect(await loadApprovalRequest(removed.client as unknown as Supabase, signConsentState(ORG, RECORD))).toEqual({
      ok: false,
      code: 'request_not_found',
    });
    const inactiveOrg = world({ msp_organizations: { name: 'Northwind MSP', primary_tenant_id: MSP_TENANT, is_active: false } });
    expect(await loadApprovalRequest(inactiveOrg.client as unknown as Supabase, signConsentState(ORG, RECORD))).toEqual({
      ok: false,
      code: 'request_not_found',
    });
  });
});

describe('checkApprover', () => {
  it.each([GLOBAL_ADMINISTRATOR_ROLE, PRIVILEGED_ROLE_ADMINISTRATOR_ROLE, INTUNE_ADMINISTRATOR_ROLE])(
    'lets an administrator of the customer tenant approve (%s)',
    async (role) => {
      const request = await openRequest(world());
      expect(await checkApprover(request, user(CUSTOMER_TENANT, [role]), null)).toMatchObject({ ok: true });
    }
  );

  it('refuses an ordinary member of the customer tenant', async () => {
    const request = await openRequest(world());
    // b79fbf4d... is the default "user" marker every member carries.
    const member = user(CUSTOMER_TENANT, ['b79fbf4d-3ef9-4689-8143-76b194e85509']);
    expect(await checkApprover(request, member, null)).toEqual({ ok: false, code: 'not_administrator' });
  });

  it("refuses the MSP's own staff, even a Global Administrator of the MSP tenant", async () => {
    const request = await openRequest(world());
    expect(await checkApprover(request, user(MSP_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]), null)).toEqual({ ok: false, code: 'own_tenant' });
  });

  it('refuses another tenant once the record is bound to a tenant', async () => {
    const request = await openRequest(world({ tenant_id: CUSTOMER_TENANT, consent_status: 'consent_incomplete' }));
    expect(await checkApprover(request, user(OTHER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]), null)).toEqual({ ok: false, code: 'tenant_mismatch' });
    expect(await checkApprover(request, user(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]), null)).toMatchObject({ ok: true });
  });

  it('fails closed when the roles cannot be determined', async () => {
    const request = await openRequest(world());
    // No wids claim and no way to ask Graph.
    expect(await checkApprover(request, user(CUSTOMER_TENANT, undefined), null)).toEqual({ ok: false, code: 'role_unknown' });

    // Graph answers, but without role template ids (no directory read permission).
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ value: [{ id: 'opaque-object-id' }] }), { status: 200 })));
    expect(await checkApprover(request, user(CUSTOMER_TENANT, undefined), 'Bearer token')).toEqual({ ok: false, code: 'role_unknown' });

    // Graph refuses.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    expect(await checkApprover(request, user(CUSTOMER_TENANT, undefined), 'Bearer token')).toEqual({ ok: false, code: 'role_unknown' });
  });

  it('uses Graph when the token has no wids claim and Graph names the roles', async () => {
    const request = await openRequest(world());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ value: [{ id: 'x', roleTemplateId: INTUNE_ADMINISTRATOR_ROLE.toUpperCase() }] }), { status: 200 }))
    );
    expect(await checkApprover(request, user(CUSTOMER_TENANT, undefined), 'Bearer token')).toMatchObject({ ok: true });
  });
});

describe('approveLink', () => {
  it("links the approver's own tenant and only marks it granted after the permission check", async () => {
    const db = world();
    const request = await openRequest(db);
    acquireConsentToken.mockResolvedValue(appToken(['DeviceManagementApps.ReadWrite.All']));

    const outcome = await approveLink(db.client as unknown as Supabase, request, user(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]));

    expect(outcome).toEqual({ ok: true, status: 'granted' });
    expect(acquireConsentToken).toHaveBeenCalledWith(CUSTOMER_TENANT);
    expect(db.tables.msp_managed_tenants[0]).toMatchObject({
      tenant_id: CUSTOMER_TENANT,
      consent_status: 'granted',
      consented_by_email: 'admin@customer.example',
    });
    expect(db.tables.tenant_consent).toHaveLength(1);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: ORG,
        action: 'tenant.consent_granted',
        user_email: 'admin@customer.example',
        details: expect.objectContaining({ tenant_id: CUSTOMER_TENANT }),
      })
    );
    // There is never a 'granted' write before verification: the only write
    // that changes the record is the final one.
    const recordWrites = db.writes.filter((write) => write.table === 'msp_managed_tenants' && write.affected > 0);
    expect(recordWrites).toHaveLength(1);
  });

  it.each([
    ['the app has no Intune permission in the tenant', () => appToken(['Group.Read.All'])],
    ['no app token can be acquired', () => ({ ok: false as const, error: 'consent_not_granted', errorCode: 'AADSTS65001', errorDescription: '' })],
    ['the app token is unreadable', () => ({ ok: true as const, accessToken: 'not-a-jwt' })],
  ])('writes nothing and keeps the request open when %s', async (_name, result) => {
    const db = world();
    const request = await openRequest(db);
    acquireConsentToken.mockResolvedValue(result());

    const outcome = await approveLink(db.client as unknown as Supabase, request, user(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]));

    expect(outcome).toEqual({ ok: true, status: 'permissions_incomplete' });
    expect(db.writes).toEqual([]);
    expect(db.tables.msp_managed_tenants[0]).toMatchObject({ consent_status: 'pending', tenant_id: null });
    expect(db.tables.tenant_consent).toHaveLength(0);
    expect(createAuditLog).not.toHaveBeenCalled();

    // The administrator can approve again once the permission is active.
    acquireConsentToken.mockResolvedValue(appToken(['DeviceManagementApps.ReadWrite.All']));
    const retry = await approveLink(db.client as unknown as Supabase, await openRequest(db), user(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]));
    expect(retry).toEqual({ ok: true, status: 'granted' });
  });

  it('only ever stores a status the database accepts', async () => {
    // The CHECK constraint on msp_managed_tenants allows pending, granted and revoked.
    const db = world();
    acquireConsentToken.mockResolvedValueOnce(appToken([])).mockResolvedValue(appToken(['DeviceManagementApps.ReadWrite.All']));

    await approveLink(db.client as unknown as Supabase, await openRequest(db), user(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]));
    await approveLink(db.client as unknown as Supabase, await openRequest(db), user(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]));

    const statuses = db.writes.map((write) => write.values?.consent_status).filter(Boolean);
    expect(statuses).toEqual(['granted']);
  });

  it('lets a customer that was removed earlier be linked again', async () => {
    // The unique index on (organization, tenant) also covers inactive records.
    const db = world({}, [
      { id: 'removed-earlier', msp_organization_id: ORG, tenant_id: CUSTOMER_TENANT, consent_status: 'granted', is_active: false },
      { id: 'other-org', msp_organization_id: 'another-org', tenant_id: CUSTOMER_TENANT, consent_status: 'granted', is_active: false },
    ]);
    const request = await openRequest(db);
    acquireConsentToken.mockResolvedValue(appToken(['DeviceManagementApps.ReadWrite.All']));

    const outcome = await approveLink(db.client as unknown as Supabase, request, user(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]));

    expect(outcome).toEqual({ ok: true, status: 'granted' });
    const rows = Object.fromEntries(db.tables.msp_managed_tenants.map((row) => [row.id, row.tenant_id]));
    expect(rows).toEqual({ [RECORD]: CUSTOMER_TENANT, 'removed-earlier': null, 'other-org': CUSTOMER_TENANT });
    // At no point do two records of the organization hold the tenant.
    const holders = db.tables.msp_managed_tenants.filter((row) => row.msp_organization_id === ORG && row.tenant_id === CUSTOMER_TENANT);
    expect(holders).toHaveLength(1);
  });

  it('does not overwrite the consent record of a tenant that already uses IntuneGet', async () => {
    const db = world();
    db.tables.tenant_consent.push({
      tenant_id: CUSTOMER_TENANT,
      consented_by_user_id: 'their-own-admin',
      consent_granted_at: '2026-01-01T00:00:00.000Z',
      is_active: true,
    });
    const request = await openRequest(db);
    acquireConsentToken.mockResolvedValue(appToken(['DeviceManagementApps.ReadWrite.All']));

    await approveLink(db.client as unknown as Supabase, request, user(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]));

    expect(db.tables.tenant_consent).toEqual([
      { tenant_id: CUSTOMER_TENANT, consented_by_user_id: 'their-own-admin', consent_granted_at: '2026-01-01T00:00:00.000Z', is_active: true },
    ]);
  });

  it('reports an existing link instead of creating a second one', async () => {
    const db = world({}, [
      { id: 'existing', msp_organization_id: ORG, tenant_id: CUSTOMER_TENANT, consent_status: 'granted', is_active: true },
    ]);
    const request = await openRequest(db);

    const outcome = await approveLink(db.client as unknown as Supabase, request, user(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]));

    expect(outcome).toEqual({ ok: true, status: 'already_managed' });
    expect(acquireConsentToken).not.toHaveBeenCalled();
    expect(db.tables.msp_managed_tenants.map((row) => row.id)).toEqual(['existing']);
  });

  it('does nothing when the record was completed in the meantime', async () => {
    const db = world();
    const request = await openRequest(db);
    db.tables.msp_managed_tenants[0].consent_status = 'granted';
    db.tables.msp_managed_tenants[0].tenant_id = OTHER_TENANT;
    acquireConsentToken.mockResolvedValue(appToken(['DeviceManagementApps.ReadWrite.All']));

    const outcome = await approveLink(db.client as unknown as Supabase, request, user(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]));

    expect(outcome).toEqual({ ok: false, code: 'request_closed' });
    expect(db.tables.msp_managed_tenants[0].tenant_id).toBe(OTHER_TENANT);
  });
});
