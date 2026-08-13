import { NextRequest } from 'next/server';

const { parseAccessTokenMock, getDatabaseMock, getAllByUserIdMock } = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  getDatabaseMock: vi.fn(),
  getAllByUserIdMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}));

import { GET } from '@/app/api/analytics/stats/route';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    winget_id: 'Microsoft.Edge',
    display_name: 'Edge',
    status: 'deployed',
    created_at: '2026-08-01T10:00:00Z',
    completed_at: '2026-08-01T10:05:00Z',
    intune_app_url: null,
    ...overrides,
  };
}

function makeRequest() {
  const request = new NextRequest('http://localhost:3000/api/analytics/stats');
  request.headers.set('Authorization', 'Bearer test-token');
  return request;
}

describe('GET /api/analytics/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDatabaseMock.mockReturnValue({ jobs: { getAllByUserId: getAllByUserIdMock } });
    getAllByUserIdMock.mockResolvedValue([]);
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-1',
      userName: 'User',
    });
  });

  it('aggregates job states without touching Supabase', async () => {
    // Regression: the route called createServerClient() unconditionally, which
    // throws without Supabase config, so the dashboard got a 500 on every load
    // in a self-hosted SQLite install. packaging_jobs exists in both backends,
    // so these stats can be served rather than merely not crashing.
    vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));
    getAllByUserIdMock.mockResolvedValue([
      makeJob({ id: 'a', status: 'deployed', completed_at: '2026-08-02T10:00:00Z' }),
      makeJob({ id: 'b', status: 'completed', completed_at: '2026-07-20T10:00:00Z' }),
      makeJob({ id: 'c', status: 'failed', completed_at: null }),
      makeJob({ id: 'd', status: 'queued', completed_at: null }),
      makeJob({ id: 'e', status: 'uploading', completed_at: null }),
    ]);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totalDeployed).toBe(2);
    // Only the August one counts; the July job is a prior month.
    expect(body.thisMonth).toBe(1);
    expect(body.pending).toBe(2);
    expect(body.failed).toBe(1);
    expect(getAllByUserIdMock).toHaveBeenCalledWith('user-1');

    vi.useRealTimers();
  });

  it('builds the activity feed from the five newest jobs', async () => {
    // getAllByUserId returns newest first, so the feed is the head of it.
    getAllByUserIdMock.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) =>
        makeJob({ id: `job-${i}`, display_name: `App ${i}`, status: 'deployed' })
      )
    );

    const body = await (await GET(makeRequest())).json();

    expect(body.recentActivity).toHaveLength(5);
    expect(body.recentActivity[0]).toMatchObject({
      id: 'job-0',
      type: 'upload',
      status: 'success',
      description: 'Deployed App 0',
    });
  });

  it('returns 401 without valid auth', async () => {
    parseAccessTokenMock.mockResolvedValue(null);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(getAllByUserIdMock).not.toHaveBeenCalled();
  });
});
