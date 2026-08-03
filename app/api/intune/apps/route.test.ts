import { NextRequest } from 'next/server';

const {
  parseAccessTokenMock,
  getServicePrincipalTokenMock,
  createServerClientMock,
  isSupabaseConfiguredMock,
  resolveTargetTenantIdMock,
  fetchMock,
} = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  getServicePrincipalTokenMock: vi.fn(),
  createServerClientMock: vi.fn(),
  isSupabaseConfiguredMock: vi.fn(),
  resolveTargetTenantIdMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/intune/graph-client', () => ({
  getServicePrincipalToken: getServicePrincipalTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: createServerClientMock,
  isSupabaseConfigured: isSupabaseConfiguredMock,
}));

vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: resolveTargetTenantIdMock,
}));

import { GET } from '@/app/api/intune/apps/route';

describe('GET /api/intune/apps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock;
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-1',
      userName: 'User',
    });
    getServicePrincipalTokenMock.mockResolvedValue('graph-token');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [] }),
    });
  });

  it('lists apps without touching Supabase when running Supabase-less (DATABASE_MODE=sqlite, no MSP config)', async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);

    const request = new NextRequest('http://localhost:3000/api/intune/apps', {
      headers: { Authorization: 'Bearer test-token' },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.apps).toEqual([]);
    // The regression this guards against: the route called createServerClient()
    // and queried the tenant_consent table unconditionally, which throws (or
    // 403s) in installs that don't configure Supabase.
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(resolveTargetTenantIdMock).not.toHaveBeenCalled();
    expect(getServicePrincipalTokenMock).toHaveBeenCalledWith('tenant-1');
  });

  it('resolves the MSP tenant and checks consent when Supabase is configured', async () => {
    isSupabaseConfiguredMock.mockReturnValue(true);
    const supabaseStub = { from: vi.fn() };
    createServerClientMock.mockReturnValue(supabaseStub);
    resolveTargetTenantIdMock.mockResolvedValue({
      tenantId: 'tenant-2',
      errorResponse: null,
    });
    const single = vi.fn().mockResolvedValue({ data: { is_active: true }, error: null });
    const eq2 = vi.fn().mockReturnValue({ single });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    supabaseStub.from.mockReturnValue({ select });

    const request = new NextRequest('http://localhost:3000/api/intune/apps', {
      headers: { Authorization: 'Bearer test-token' },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(resolveTargetTenantIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokenTenantId: 'tenant-1' })
    );
    expect(getServicePrincipalTokenMock).toHaveBeenCalledWith('tenant-2');
  });

  it('returns 403 when Supabase is configured but consent is missing', async () => {
    isSupabaseConfiguredMock.mockReturnValue(true);
    const supabaseStub = { from: vi.fn() };
    createServerClientMock.mockReturnValue(supabaseStub);
    resolveTargetTenantIdMock.mockResolvedValue({
      tenantId: 'tenant-2',
      errorResponse: null,
    });
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } });
    const eq2 = vi.fn().mockReturnValue({ single });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    supabaseStub.from.mockReturnValue({ select });

    const request = new NextRequest('http://localhost:3000/api/intune/apps', {
      headers: { Authorization: 'Bearer test-token' },
    });

    const response = await GET(request);

    expect(response.status).toBe(403);
    expect(getServicePrincipalTokenMock).not.toHaveBeenCalled();
  });
});
