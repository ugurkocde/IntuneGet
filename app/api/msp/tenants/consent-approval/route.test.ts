import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { auth, client, acquireConsentToken } = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  acquireConsentToken: vi.fn(),
}));
vi.mock('@/lib/auth-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-utils')>()),
  parseAccessToken: auth,
}));
vi.mock('@/lib/supabase', () => ({ createServerClient: client }));
vi.mock('@/lib/consent-token', () => ({ acquireConsentToken }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  getIpKey: () => 'ip',
  STRICT_RATE_LIMIT: {},
}));
vi.mock('@/lib/audit-logger', () => ({ createAuditLog: vi.fn(async () => {}), getRequestMetadata: () => ({}) }));
vi.mock('@/lib/permission-logger', () => ({
  logConsentStatus: vi.fn(),
  logPermissions: vi.fn(),
  logTokenAcquired: vi.fn(),
}));

import { signConsentState } from '@/lib/auth-utils';
import { GLOBAL_ADMINISTRATOR_ROLE } from '@/lib/auth/directory-roles';
import { createFakeSupabase } from '@/lib/msp/test-support/fake-supabase';
import { GET, POST } from './route';

const ORG = '55555555-aaaa-4bbb-8ccc-666666666666';
const RECORD = '77777777-aaaa-4bbb-8ccc-888888888888';
const MSP_TENANT = 'aaaaaaaa-0000-4000-8000-000000000001';
const CUSTOMER_TENANT = 'bbbbbbbb-0000-4000-8000-000000000002';
const VICTIM_TENANT = 'dddddddd-0000-4000-8000-000000000004';

function world() {
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
      },
    ],
    tenant_consent: [],
    msp_user_memberships: [{ msp_organization_id: ORG, user_id: 'msp-user', user_email: 'tech@northwind.example' }],
  });
}

function signedIn(tenantId: string, directoryRoles: string[] | undefined) {
  auth.mockResolvedValue({ userId: 'u1', userEmail: 'someone@example.test', tenantId, userName: null, directoryRoles });
}

function post(body: unknown) {
  return POST(
    new NextRequest('https://app.example/api/msp/tenants/consent-approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
      body: JSON.stringify(body),
    })
  );
}

let db: ReturnType<typeof world>;

beforeEach(() => {
  vi.stubEnv('MSP_STATE_SECRET', 'unit-test-secret');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  auth.mockReset();
  acquireConsentToken.mockReset();
  acquireConsentToken.mockResolvedValue({
    ok: true,
    accessToken: `h.${Buffer.from(JSON.stringify({ roles: ['DeviceManagementApps.ReadWrite.All'] })).toString('base64')}.s`,
  });
  db = world();
  client.mockReset();
  client.mockReturnValue(db.client);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/msp/tenants/consent-approval', () => {
  it('needs a signed-in user', async () => {
    auth.mockResolvedValue(null);
    const response = await post({ state: signConsentState(ORG, RECORD) });
    expect(response.status).toBe(401);
    expect(db.writes).toEqual([]);
  });

  it('links the tenant of the signed-in administrator', async () => {
    signedIn(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]);
    const response = await post({ state: signConsentState(ORG, RECORD) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'granted', organization_name: 'Northwind MSP' });
    expect(db.tables.msp_managed_tenants[0]).toMatchObject({ tenant_id: CUSTOMER_TENANT, consent_status: 'granted' });
  });

  it('ignores any tenant named in the request and uses the sign-in', async () => {
    signedIn(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]);
    await post({ state: signConsentState(ORG, RECORD), tenant: VICTIM_TENANT, tenant_id: VICTIM_TENANT });
    expect(db.tables.msp_managed_tenants[0].tenant_id).toBe(CUSTOMER_TENANT);
    expect(acquireConsentToken).toHaveBeenCalledWith(CUSTOMER_TENANT);
  });

  it.each([
    ['the MSP itself, signed in from its own tenant', MSP_TENANT, [GLOBAL_ADMINISTRATOR_ROLE], 'own_tenant'],
    ['a member of the customer without an administrator role', CUSTOMER_TENANT, [], 'not_administrator'],
    ['a user whose roles are unknown', CUSTOMER_TENANT, undefined, 'role_unknown'],
  ])('refuses %s and changes nothing', async (_name, tenantId, roles, code) => {
    signedIn(tenantId, roles);
    // No Graph fallback available in this test.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));

    const response = await post({ state: signConsentState(ORG, RECORD) });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe(code);
    expect(db.writes).toEqual([]);
    expect(acquireConsentToken).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('refuses a missing or forged state', async () => {
    signedIn(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]);
    expect((await post({})).status).toBe(400);
    expect((await post({ state: `${ORG}:${RECORD}:${Date.now()}:forged` })).status).toBe(400);
    expect(db.writes).toEqual([]);
  });

  it('cannot be replayed once the link exists', async () => {
    signedIn(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]);
    const state = signConsentState(ORG, RECORD);
    expect((await post({ state })).status).toBe(200);
    const again = await post({ state });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('request_closed');
  });
});

describe('GET /api/msp/tenants/consent-approval', () => {
  function get(state: string) {
    return GET(
      new NextRequest(`https://app.example/api/msp/tenants/consent-approval?state=${encodeURIComponent(state)}`, {
        headers: { authorization: 'Bearer token' },
      })
    );
  }

  it('names the MSP only to a signed-in user', async () => {
    auth.mockResolvedValue(null);
    expect((await get(signConsentState(ORG, RECORD))).status).toBe(401);

    signedIn(CUSTOMER_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]);
    const response = await get(signConsentState(ORG, RECORD));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      organization_name: 'Northwind MSP',
      requested_by: 'tech@northwind.example',
      can_approve: true,
      blocked_reason: null,
    });
  });

  it('tells a user who cannot approve why, without changing anything', async () => {
    signedIn(MSP_TENANT, [GLOBAL_ADMINISTRATOR_ROLE]);
    const response = await get(signConsentState(ORG, RECORD));
    expect(await response.json()).toMatchObject({ can_approve: false, blocked_reason: 'own_tenant' });
    expect(db.writes).toEqual([]);
  });
});
