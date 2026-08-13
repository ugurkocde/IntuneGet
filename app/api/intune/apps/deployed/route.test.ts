import { NextRequest, NextResponse } from 'next/server';

const {
  parseAccessTokenMock,
  getServerClientOrNullMock,
  resolveTargetTenantIdMock,
} = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  getServerClientOrNullMock: vi.fn(),
  resolveTargetTenantIdMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  getServerClientOrNull: getServerClientOrNullMock,
}));

vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: resolveTargetTenantIdMock,
}));

import { GET } from '@/app/api/intune/apps/deployed/route';

function createAwaitableUploadHistoryQuery(
  result: { data: unknown; error: unknown },
  operations: Array<{ method: string; args: unknown[] }>
) {
  const query: Record<string, unknown> = {};

  query.select = (...args: unknown[]) => {
    operations.push({ method: 'select', args });
    return query;
  };
  query.eq = (...args: unknown[]) => {
    operations.push({ method: 'eq', args });
    return query;
  };
  query.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve(result).then(resolve);

  return query;
}

describe('GET /api/intune/apps/deployed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unique deployed winget IDs for authenticated user and tenant', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-home',
      userName: 'User',
    });

    const operations: Array<{ method: string; args: unknown[] }> = [];
    const uploadHistoryQuery = createAwaitableUploadHistoryQuery(
      {
        data: [
          { winget_id: 'Microsoft.Edge' },
          { winget_id: 'Microsoft.Edge' },
          { winget_id: 'Git.Git' },
        ],
        error: null,
      },
      operations
    );

    getServerClientOrNullMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'upload_history') {
          return uploadHistoryQuery;
        }
        throw new Error(`Unexpected table: ${table}`);
      },
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
    expect(body.deployedWingetIds).toEqual(['Microsoft.Edge', 'Git.Git']);
    expect(body.count).toBe(2);
    expect(
      operations.some(
        (op) => op.method === 'eq' && op.args[0] === 'user_id' && op.args[1] === 'user-1'
      )
    ).toBe(true);
    expect(
      operations.some(
        (op) => op.method === 'eq' && op.args[0] === 'intune_tenant_id' && op.args[1] === 'tenant-home'
      )
    ).toBe(true);
  });

  it('applies tenant override via X-MSP-Tenant-Id', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-home',
      userName: 'User',
    });

    const uploadHistoryQuery = createAwaitableUploadHistoryQuery(
      { data: [], error: null },
      []
    );

    getServerClientOrNullMock.mockReturnValue({
      from: () => uploadHistoryQuery,
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

    getServerClientOrNullMock.mockReturnValue({
      from: vi.fn(),
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

    const uploadHistoryQuery = createAwaitableUploadHistoryQuery(
      { data: [], error: null },
      []
    );

    getServerClientOrNullMock.mockReturnValue({
      from: () => uploadHistoryQuery,
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
});
