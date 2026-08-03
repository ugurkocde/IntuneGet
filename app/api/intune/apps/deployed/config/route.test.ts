import { NextRequest } from 'next/server';

const {
  parseAccessTokenMock,
  createServerClientMock,
  isSupabaseConfiguredMock,
  resolveTargetTenantIdMock,
  getDatabaseMock,
  getByUserIdMock,
} = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  createServerClientMock: vi.fn(),
  isSupabaseConfiguredMock: vi.fn(),
  resolveTargetTenantIdMock: vi.fn(),
  getDatabaseMock: vi.fn(),
  getByUserIdMock: vi.fn(),
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

import { GET } from '@/app/api/intune/apps/deployed/config/route';

describe('GET /api/intune/apps/deployed/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSupabaseConfiguredMock.mockReturnValue(true);
    getDatabaseMock.mockReturnValue({ jobs: { getByUserId: getByUserIdMock } });
    getByUserIdMock.mockResolvedValue([]);
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
  });

  it('returns the most recently deployed config for the given wingetId', async () => {
    getByUserIdMock.mockResolvedValue([
      {
        tenant_id: 'tenant-home',
        winget_id: 'Microsoft.Edge',
        status: 'deployed',
        completed_at: '2026-01-01T00:00:00.000Z',
        package_config: { installScope: 'machine' },
        intune_app_id: 'app-old',
      },
      {
        tenant_id: 'tenant-home',
        winget_id: 'Microsoft.Edge',
        status: 'deployed',
        completed_at: '2026-02-01T00:00:00.000Z',
        package_config: { installScope: 'user' },
        intune_app_id: 'app-new',
      },
    ]);

    const request = new NextRequest(
      'http://localhost:3000/api/intune/apps/deployed/config?wingetId=Microsoft.Edge'
    );
    request.headers.set('Authorization', 'Bearer test-token');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.config).toEqual({ installScope: 'user' });
    expect(body.intuneAppId).toBe('app-new');
  });

  it('returns nulls when no deployed job matches', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/intune/apps/deployed/config?wingetId=Nothing.Here'
    );
    request.headers.set('Authorization', 'Bearer test-token');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ config: null, deployedAt: null, intuneAppId: null });
  });

  it('requires wingetId', async () => {
    const request = new NextRequest('http://localhost:3000/api/intune/apps/deployed/config');
    request.headers.set('Authorization', 'Bearer test-token');

    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('resolves config without touching Supabase when running Supabase-less (DATABASE_MODE=sqlite, no MSP config)', async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);
    getByUserIdMock.mockResolvedValue([
      {
        tenant_id: 'tenant-home',
        winget_id: 'Microsoft.Edge',
        status: 'deployed',
        completed_at: '2026-01-01T00:00:00.000Z',
        package_config: { installScope: 'machine' },
        intune_app_id: 'app-1',
      },
    ]);

    const request = new NextRequest(
      'http://localhost:3000/api/intune/apps/deployed/config?wingetId=Microsoft.Edge'
    );
    request.headers.set('Authorization', 'Bearer test-token');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.intuneAppId).toBe('app-1');
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(resolveTargetTenantIdMock).not.toHaveBeenCalled();
  });
});
