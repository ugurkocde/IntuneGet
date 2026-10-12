import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { CuratedConfigVerificationError } from '@/lib/curated-catalog/custom-config';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

const state = vi.hoisted(() => ({
  user: { userId: 'user', userEmail: 'admin@example.test', tenantId: 'tenant' } as object | null,
  role: 'operator', tenantError: false, reconcile: vi.fn(),
}));
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => state.user }));
vi.mock('@/lib/supabase', () => ({
  isSupabaseServerConfigured: () => true,
  createServerClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: state.role } }) }) }) }) }),
}));
vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: async ({ tokenTenantId, requestedTenantId }: { tokenTenantId: string; requestedTenantId: string | null }) => ({
    tenantId: requestedTenantId || tokenTenantId,
    errorResponse: state.tenantError ? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) : null,
  }),
}));
vi.mock('@/lib/curated-catalog/server', () => ({
  reconcileCuratedCartItem: state.reconcile,
  getApprovedCuratedRelease: () => ({ app: {}, release: {} }),
}));
vi.mock('@/lib/curated-catalog/package', () => ({ buildCuratedCartItem: () => ({ psadtConfig: DEFAULT_PSADT_CONFIG }) }));
import { POST } from './route';

const item = { id: 'firefox', appSource: 'win32', sourceType: 'curated', wingetId: 'IntuneGet.Curated.FirefoxESR', version: '140.17.0', psadtConfig: DEFAULT_PSADT_CONFIG };
const call = (items: unknown = [item], tenant?: string) => POST(new NextRequest('http://localhost/api/curated-catalog/settings-verification', {
  method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json', ...(tenant ? { 'X-MSP-Tenant-Id': tenant } : {}) },
  body: JSON.stringify({ items }),
}));

describe('advance curated settings verification', () => {
  beforeEach(() => {
    state.user = { userId: 'user', userEmail: 'admin@example.test', tenantId: 'tenant' };
    state.role = 'operator'; state.tenantError = false; state.reconcile.mockReset().mockResolvedValue({});
  });
  it('requires authentication and an authorized target tenant before queuing', async () => {
    state.user = null;
    expect((await call()).status).toBe(401);
    state.user = { userId: 'user', tenantId: 'tenant' }; state.tenantError = true;
    expect((await call([item], 'foreign')).status).toBe(403);
    state.tenantError = false; state.role = 'viewer';
    expect((await call([item], 'customer')).status).toBe(403);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it('queues for the resolved tenant and returns ready for approved settings', async () => {
    const response = await call([item], 'customer');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ items: [{ itemId: item.id, status: 'ready' }] });
    expect(state.reconcile).toHaveBeenCalledWith(item, { tenantId: 'customer', userId: 'user' });
  });
  it.each(['requested', 'verifying', 'failed'] as const)('reports %s as a normal status with tested defaults', async status => {
    state.reconcile.mockRejectedValue(new CuratedConfigVerificationError('Internal detail', status));
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ itemId: item.id, status, defaultConfig: DEFAULT_PSADT_CONFIG }] });
  });
  it('rejects non-curated and oversized requests without queuing', async () => {
    expect((await call([{ ...item, sourceType: 'winget' }])).status).toBe(400);
    expect((await call(Array.from({ length: 101 }, () => item))).status).toBe(400);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it('restores tested behaviour while preserving presentation choices', async () => {
    state.reconcile.mockRejectedValue(new CuratedConfigVerificationError('Waiting', 'requested'));
    const response = await call([{ ...item, psadtConfig: { ...DEFAULT_PSADT_CONFIG, brandingCompanyName: 'Example', processesToClose: [{ name: 'firefox' }] } }]);
    expect((await response.json()).items[0].defaultConfig).toMatchObject({ brandingCompanyName: 'Example', processesToClose: [] });
  });
  it('fails closed on an unexpected outage without exposing internal details', async () => {
    state.reconcile.mockRejectedValue(new Error('Secret database diagnostic'));
    const response = await call();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('Secret');
  });
});
