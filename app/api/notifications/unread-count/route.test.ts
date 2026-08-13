import { NextRequest } from 'next/server';

const { parseAccessTokenMock, createServerClientMock, isSupabaseConfiguredMock } = vi.hoisted(
  () => ({
    parseAccessTokenMock: vi.fn(),
    createServerClientMock: vi.fn(),
    isSupabaseConfiguredMock: vi.fn(),
  })
);

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: createServerClientMock,
  isSupabaseConfigured: isSupabaseConfiguredMock,
}));

import { GET } from '@/app/api/notifications/unread-count/route';

function makeRequest() {
  const request = new NextRequest('http://localhost:3000/api/notifications/unread-count');
  request.headers.set('Authorization', 'Bearer test-token');
  return request;
}

describe('GET /api/notifications/unread-count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSupabaseConfiguredMock.mockReturnValue(true);
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-1',
      userName: 'User',
    });
  });

  it('returns an empty badge without Supabase instead of crashing', async () => {
    // Regression: the route called createServerClient() unconditionally, which
    // throws without Supabase config, so every dashboard load logged a 500.
    // user_notifications is Supabase-only, so an empty count is the honest
    // answer here.
    isSupabaseConfiguredMock.mockReturnValue(false);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unread_count).toBe(0);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it('counts unread notifications when Supabase is configured', async () => {
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.is = vi.fn(async () => ({ count: 3, error: null }));
    createServerClientMock.mockReturnValue({ from: vi.fn(() => query) });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unread_count).toBe(3);
  });

  it('returns 401 without valid auth', async () => {
    parseAccessTokenMock.mockResolvedValue(null);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
  });
});
