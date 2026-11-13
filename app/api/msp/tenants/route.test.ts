import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { auth, client, createAuditLog } = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  createAuditLog: vi.fn(async () => {}),
}));
vi.mock('@/lib/auth-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-utils')>()),
  parseAccessToken: auth,
}));
vi.mock('@/lib/supabase', () => ({ createServerClient: client }));
vi.mock('@/lib/msal-config', () => ({ getMspCustomerConsentUrl: () => 'https://login.example/adminconsent' }));
vi.mock('@/lib/audit-logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit-logger')>()),
  createAuditLog,
  logTenantCreated: vi.fn(async (ctx, id, name) => createAuditLog({ ...ctx, action: 'tenant.created', resource_id: id, details: { display_name: name } })),
  logTenantRemoved: vi.fn(async (ctx, id, name) => createAuditLog({ ...ctx, action: 'tenant.removed', resource_id: id, details: { display_name: name } })),
}));

import { createFakeSupabase } from '@/lib/msp/test-support/fake-supabase';
import { DELETE, POST } from './route';
import { POST as consentUrl } from './[id]/consent-url/route';

const ORG = 'org-1';
const PRIMARY = 'primary-tenant';
const CUSTOMER = 'customer-tenant';

function world(role: string) {
  return createFakeSupabase({
    msp_user_memberships: [
      { user_id: 'u1', msp_organization_id: ORG, access_mode: 'full', role, msp_organizations: { is_active: true, primary_tenant_id: PRIMARY } },
      { user_id: 'u2', msp_organization_id: ORG, access_mode: 'full', role: 'operator', msp_organizations: { is_active: true, primary_tenant_id: PRIMARY } },
    ],
    msp_organizations: [{ id: ORG, primary_tenant_id: PRIMARY }],
    msp_managed_tenants: [
      { id: 'rec-1', msp_organization_id: ORG, tenant_id: CUSTOMER, display_name: 'Customer', consent_status: 'granted', is_active: true },
      { id: 'rec-2', msp_organization_id: ORG, tenant_id: null, display_name: 'Waiting', consent_status: 'pending', is_active: true },
    ],
    app_update_policies: [
      { id: 'p1', user_id: 'u2', tenant_id: CUSTOMER, is_enabled: true },
      { id: 'p2', user_id: 'u2', tenant_id: PRIMARY, is_enabled: true },
      // A user of the customer who is not in the MSP: never touched.
      { id: 'p3', user_id: 'customer-admin', tenant_id: CUSTOMER, is_enabled: true },
    ],
  });
}

function request(method: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.stubEnv('MSP_STATE_SECRET', 'unit-test-secret');
  auth.mockResolvedValue({ userId: 'u1', userEmail: 'u1@msp.example', tenantId: PRIMARY, userName: null });
  createAuditLog.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MSP tenant management needs the manage_tenants permission', () => {
  it.each(['viewer', 'operator'])('refuses a %s adding, removing or relinking a tenant', async (role) => {
    const db = world(role);
    client.mockReturnValue(db.client);

    const add = await POST(request('POST', 'https://app.example/api/msp/tenants', { display_name: 'New customer' }));
    const remove = await DELETE(request('DELETE', 'https://app.example/api/msp/tenants?id=rec-1'));
    const link = await consentUrl(request('POST', 'https://app.example/api/msp/tenants/rec-2/consent-url'), {
      params: Promise.resolve({ id: 'rec-2' }),
    });

    expect([add.status, remove.status, link.status]).toEqual([403, 403, 403]);
    expect(db.writes).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it.each(['admin', 'owner'])('lets a %s add a tenant and records it', async (role) => {
    const db = world(role);
    client.mockReturnValue(db.client);

    const response = await POST(request('POST', 'https://app.example/api/msp/tenants', { display_name: 'New customer' }));

    expect(response.status).toBe(201);
    expect(db.tables.msp_managed_tenants).toHaveLength(3);
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.created', organization_id: ORG, user_id: 'u1' }));
  });

  it('removing a tenant switches off the team policies for it and nothing else', async () => {
    const db = world('admin');
    client.mockReturnValue(db.client);

    const response = await DELETE(request('DELETE', 'https://app.example/api/msp/tenants?id=rec-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, disabled_policies: 1 });
    expect(db.tables.msp_managed_tenants[0].is_active).toBe(false);
    const enabled = Object.fromEntries(db.tables.app_update_policies.map((p) => [p.id, p.is_enabled]));
    expect(enabled).toEqual({ p1: false, p2: true, p3: true });
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.removed', resource_id: 'rec-1' }));
  });

  it('lets an admin generate a new consent link for a pending record', async () => {
    const db = world('admin');
    client.mockReturnValue(db.client);

    const response = await consentUrl(request('POST', 'https://app.example/api/msp/tenants/rec-2/consent-url'), {
      params: Promise.resolve({ id: 'rec-2' }),
    });

    expect(response.status).toBe(200);
  });
});
