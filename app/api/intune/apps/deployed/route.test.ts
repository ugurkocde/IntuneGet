import { NextRequest, NextResponse } from 'next/server';

const {
  parseAccessTokenMock,
  createServerClientMock,
  isSupabaseConfiguredMock,
  resolveTargetTenantIdMock,
  getDatabaseMock,
  getByUserIdMock,
  getByTenantIdMock,
} = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  createServerClientMock: vi.fn(),
  isSupabaseConfiguredMock: vi.fn(),
  resolveTargetTenantIdMock: vi.fn(),
  getDatabaseMock: vi.fn(),
  getByUserIdMock: vi.fn(),
  getByTenantIdMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: createServerClientMock,
  isSupabaseConfigured: isSupabaseConfiguredMock,
}));

vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: resolveTargetTenantIdMock,
}));

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}));

import { GET } from '@/app/api/intune/apps/deployed/route';

describe('GET /api/intune/apps/deployed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSupabaseConfiguredMock.mockReturnValue(true);
    getDatabaseMock.mockReturnValue({
      uploadHistory: { getByUserId: getByUserIdMock },
      jobs: { getByTenantId: getByTenantIdMock },
    });
    getByUserIdMock.mockResolvedValue([]);
    getByTenantIdMock.mockResolvedValue([]);
  });

  it('returns unique deployed winget IDs for authenticated user and tenant', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-home',
      userName: 'User',
    });
    resolveTargetTenantIdMock.mockResolvedValue({
      tenantId: 'tenant-home',
      errorResponse: null,
    });
    getByUserIdMock.mockResolvedValue([
      { winget_id: 'Microsoft.Edge', intune_tenant_id: 'tenant-home' },
      { winget_id: 'Microsoft.Edge', intune_tenant_id: 'tenant-home' },
      { winget_id: 'Git.Git', intune_tenant_id: 'tenant-home' },
      { winget_id: 'Other.App', intune_tenant_id: 'tenant-other' },
    ]);

    const request = new NextRequest('http://localhost:3000/api/intune/apps/deployed');
    request.headers.set('Authorization', 'Bearer test-token');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deployedWingetIds).toEqual(['Microsoft.Edge', 'Git.Git']);
    expect(body.count).toBe(2);
    expect(getByUserIdMock).toHaveBeenCalledWith('user-1', 500);
  });

  it('applies tenant override via X-MSP-Tenant-Id', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-home',
      userName: 'User',
    });
    resolveTargetTenantIdMock.mockResolvedValue({
      tenantId: 'tenant-managed',
      errorResponse: null,
    });

    const request = new NextRequest('http://localhost:3000/api/intune/apps/deployed');
    request.headers.set('Authorization', 'Bearer test-token');
    request.headers.set('X-MSP-Tenant-Id', 'tenant-managed');

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(resolveTargetTenantIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tokenTenantId: 'tenant-home',
        requestedTenantId: 'tenant-managed',
      })
    );
  });

  it('returns 401 without valid auth', async () => {
    parseAccessTokenMock.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/intune/apps/deployed');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns resolver-provided 403 response for unauthorized tenant access', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-home',
      userName: 'User',
    });
    resolveTargetTenantIdMock.mockResolvedValue({
      tenantId: 'tenant-home',
      errorResponse: NextResponse.json(
        { error: 'Not authorized to access other tenants' },
        { status: 403 }
      ),
    });

    const request = new NextRequest('http://localhost:3000/api/intune/apps/deployed');
    request.headers.set('Authorization', 'Bearer test-token');
    request.headers.set('X-MSP-Tenant-Id', 'tenant-blocked');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Not authorized to access other tenants');
  });

  it('handles empty deployment history', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-home',
      userName: 'User',
    });
    resolveTargetTenantIdMock.mockResolvedValue({
      tenantId: 'tenant-home',
      errorResponse: null,
    });

    const request = new NextRequest('http://localhost:3000/api/intune/apps/deployed');
    request.headers.set('Authorization', 'Bearer test-token');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deployedWingetIds).toEqual([]);
    expect(body.count).toBe(0);
  });

  it('returns tenant-scoped deployments with attribution when scope=tenant', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-home',
      userName: 'User',
    });
    resolveTargetTenantIdMock.mockResolvedValue({
      tenantId: 'tenant-home',
      errorResponse: null,
    });
    getByTenantIdMock.mockResolvedValue([
      { winget_id: 'Microsoft.Edge', user_email: 'a@example.com', status: 'deployed' },
      { winget_id: 'Git.Git', user_email: 'b@example.com', status: 'failed' },
    ]);

    const request = new NextRequest('http://localhost:3000/api/intune/apps/deployed?scope=tenant');
    request.headers.set('Authorization', 'Bearer test-token');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scope).toBe('tenant');
    expect(body.tenantDeployments).toEqual([
      { wingetId: 'Microsoft.Edge', deployedBy: 'a@example.com' },
    ]);
  });

  it('resolves deployments without touching Supabase when running Supabase-less (DATABASE_MODE=sqlite, no MSP config)', async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-home',
      userName: 'User',
    });
    getByUserIdMock.mockResolvedValue([
      { winget_id: 'Microsoft.Edge', intune_tenant_id: 'tenant-home' },
    ]);

    const request = new NextRequest('http://localhost:3000/api/intune/apps/deployed');
    request.headers.set('Authorization', 'Bearer test-token');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deployedWingetIds).toEqual(['Microsoft.Edge']);
    // The regression this guards against: the route called createServerClient()
    // and queried Supabase tables directly, unconditionally.
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(resolveTargetTenantIdMock).not.toHaveBeenCalled();
  });
});
