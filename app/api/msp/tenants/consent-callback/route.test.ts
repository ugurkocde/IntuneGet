import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { client, acquireConsentToken } = vi.hoisted(() => ({ client: vi.fn(), acquireConsentToken: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ createServerClient: client }));
vi.mock('@/lib/consent-token', () => ({ acquireConsentToken }));
vi.mock('@/lib/audit-logger', () => ({ createAuditLog: vi.fn(async () => {}) }));
vi.mock('@/lib/permission-logger', () => ({
  logConsentCallback: vi.fn(),
  logConsentStatus: vi.fn(),
  logPermissions: vi.fn(),
  logTokenAcquired: vi.fn(),
}));

import { signConsentState } from '@/lib/auth-utils';
import { createFakeSupabase } from '@/lib/msp/test-support/fake-supabase';
import { GET } from './route';

const ORG = '55555555-aaaa-4bbb-8ccc-666666666666';
const RECORD = '77777777-aaaa-4bbb-8ccc-888888888888';
const MSP_TENANT = 'aaaaaaaa-0000-4000-8000-000000000001';
const VICTIM_TENANT = 'dddddddd-0000-4000-8000-000000000004';

function world(recordOverrides: Record<string, unknown> = {}) {
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
    ],
    tenant_consent: [],
  });
}

function callback(params: Record<string, string>) {
  const url = new URL('https://app.example/api/msp/tenants/consent-callback');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return GET(new NextRequest(url));
}

beforeEach(() => {
  vi.stubEnv('MSP_STATE_SECRET', 'unit-test-secret');
  vi.stubEnv('NEXT_PUBLIC_URL', 'https://app.example');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  acquireConsentToken.mockReset();
  client.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('MSP consent callback', () => {
  it('does not link a tenant that is only named in the URL', async () => {
    // The MSP holds a valid signed state for its own pending record and opens
    // the callback by hand, naming a tenant that never ran the flow. That
    // tenant already uses IntuneGet, so an app token for it could be acquired.
    const db = world();
    client.mockReturnValue(db.client);
    acquireConsentToken.mockResolvedValue({ ok: true, accessToken: 'unused' });

    const response = await callback({
      admin_consent: 'True',
      tenant: VICTIM_TENANT,
      state: signConsentState(ORG, RECORD),
    });

    expect(db.writes).toEqual([]);
    expect(db.tables.msp_managed_tenants[0]).toMatchObject({ tenant_id: null, consent_status: 'pending' });
    expect(db.tables.tenant_consent).toEqual([]);
    expect(acquireConsentToken).not.toHaveBeenCalled();

    // The browser is sent to the approval page, where a signed-in
    // administrator of the customer has to approve. The named tenant is not
    // carried along.
    const location = new URL(response.headers.get('location') as string);
    expect(response.status).toBe(307);
    expect(location.pathname).toBe('/msp/consent/approve');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.search).not.toContain(VICTIM_TENANT);
  });

  it.each([
    [{ error: 'access_denied', error_description: '<b>You won a prize</b>' }, 'consent_denied'],
    [{ admin_consent: 'False', tenant: VICTIM_TENANT }, 'consent_not_granted'],
    [{ admin_consent: 'True', tenant: VICTIM_TENANT }, 'invalid_state'],
    [{ admin_consent: 'True', tenant: VICTIM_TENANT, state: `${ORG}:${RECORD}:${Date.now()}:forged` }, 'invalid_state'],
  ])('answers %j with the fixed code %s and no free text', async (params, code) => {
    const db = world();
    client.mockReturnValue(db.client);

    const response = await callback(params as Record<string, string>);
    const location = new URL(response.headers.get('location') as string);

    expect(location.pathname).toBe('/msp/consent/approve');
    expect([...location.searchParams.keys()]).toEqual(['error']);
    expect(location.searchParams.get('error')).toBe(code);
    expect(db.writes).toEqual([]);
  });

  it('refuses a record that is already granted', async () => {
    const db = world({ consent_status: 'granted', tenant_id: MSP_TENANT });
    client.mockReturnValue(db.client);

    const response = await callback({ admin_consent: 'True', tenant: VICTIM_TENANT, state: signConsentState(ORG, RECORD) });

    expect(new URL(response.headers.get('location') as string).searchParams.get('error')).toBe('request_closed');
    expect(db.writes).toEqual([]);
  });
});
