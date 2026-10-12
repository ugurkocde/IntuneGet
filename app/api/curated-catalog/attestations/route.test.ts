import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
import type { CuratedLicenceAttestationInput, CuratedLicenceAttestationRecord } from '@/lib/db/types';

const state = vi.hoisted(() => ({
  user: null as null | { userId: string; userEmail: string; tenantId: string },
  records: [] as CuratedLicenceAttestationRecord[],
  role: 'operator',
  tenantError: false,
}));
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: vi.fn(async () => state.user) }));
vi.mock('@/lib/supabase', () => ({
  isSupabaseServerConfigured: () => true,
  createServerClient: () => ({
    from: () => {
      const builder = { select: () => builder, eq: () => builder, single: async () => ({ data: { role: state.role }, error: null }) };
      return builder;
    },
  }),
}));
vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: vi.fn(async ({ tokenTenantId, requestedTenantId }: { tokenTenantId: string; requestedTenantId: string | null }) => state.tenantError
    ? { tenantId: tokenTenantId, errorResponse: NextResponse.json({ error: 'Not authorized to access other tenants' }, { status: 403 }) }
    : { tenantId: requestedTenantId || tokenTenantId, errorResponse: null }),
}));
vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    curatedLicenceAttestations: {
      listByTenant: async (tenantId: string) => state.records.filter(record => record.tenant_id === tenantId),
      accept: async (input: CuratedLicenceAttestationInput) => {
        const existing = state.records.find(record => record.tenant_id === input.tenant_id &&
          record.attestation_id === input.attestation_id && record.attestation_version === input.attestation_version);
        if (existing) return existing;
        const record = { ...input, id: `acceptance-${state.records.length}`, accepted_at: '2026-10-04T10:00:00.000Z' };
        state.records.push(record);
        return record;
      },
    },
  }),
}));
import { GET, POST } from './route';

const acrobat = CURATED_APPS.find(app => app.id === 'acrobat-reader')!;
const attestation = acrobat.licenceAttestation!;
const call = (method: 'GET' | 'POST', body?: unknown, tenant?: string) => {
  const request = new NextRequest('http://localhost/api/curated-catalog/attestations', {
    method,
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json', ...(tenant ? { 'X-MSP-Tenant-Id': tenant } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return method === 'GET' ? GET(request) : POST(request);
};
const acceptance = { appId: acrobat.id, attestationId: attestation.id, attestationVersion: attestation.version, accepted: true };

describe('curated licence attestation API', () => {
  beforeEach(() => {
    state.user = { userId: 'user-1', userEmail: 'admin@contoso.test', tenantId: 'tenant-1' };
    state.records = [];
    state.role = 'operator';
    state.tenantError = false;
  });

  it('requires authentication', async () => {
    state.user = null;
    expect((await call('GET')).status).toBe(401);
    expect((await call('POST', acceptance)).status).toBe(401);
  });

  it('reports the requirement as not accepted for a new tenant', async () => {
    const response = await call('GET');
    expect(response.status).toBe(200);
    expect((await response.json()).attestations).toEqual([
      { appId: acrobat.id, attestation, accepted: false, acceptedAt: null, acceptedByEmail: null },
    ]);
  });

  it('requires explicit acceptance of the current agreement version', async () => {
    expect((await call('POST', { ...acceptance, accepted: 'yes' })).status).toBe(400);
    expect((await call('POST', { ...acceptance, attestationVersion: '2025-01-01' })).status).toBe(409);
    expect((await call('POST', { ...acceptance, appId: 'chrome' })).status).toBe(404);
    expect(state.records).toHaveLength(0);
  });

  it('records the acceptance for the caller\'s tenant only', async () => {
    const response = await call('POST', acceptance);
    expect(response.status).toBe(200);
    expect(state.records).toEqual([expect.objectContaining({
      tenant_id: 'tenant-1', app_id: acrobat.id, attestation_id: attestation.id, attestation_version: attestation.version,
      accepted_by_user_id: 'user-1', accepted_by_email: 'admin@contoso.test',
    })]);
    expect((await (await call('GET')).json()).attestations[0]).toMatchObject({ accepted: true, acceptedByEmail: 'admin@contoso.test' });
    state.user = { userId: 'user-2', userEmail: 'other@fabrikam.test', tenantId: 'tenant-2' };
    expect((await (await call('GET')).json()).attestations[0].accepted).toBe(false);
  });

  it('lets an MSP member accept for a managed tenant only with the deploy permission', async () => {
    state.role = 'viewer';
    expect((await call('POST', acceptance, 'customer-tenant')).status).toBe(403);
    state.role = 'operator';
    expect((await call('POST', acceptance, 'customer-tenant')).status).toBe(200);
    expect(state.records[0].tenant_id).toBe('customer-tenant');
  });

  it('rejects tenants the caller cannot target', async () => {
    state.tenantError = true;
    expect((await call('POST', acceptance, 'foreign-tenant')).status).toBe(403);
    expect(state.records).toHaveLength(0);
  });
});
