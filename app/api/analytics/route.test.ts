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

import { GET } from '@/app/api/analytics/route';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    winget_id: 'Microsoft.Edge',
    display_name: 'Edge',
    publisher: 'Microsoft',
    status: 'completed',
    error_message: null,
    created_at: '2026-08-10T10:00:00.000Z',
    completed_at: '2026-08-10T10:05:00.000Z',
    ...overrides,
  };
}

function makeRequest(days?: number) {
  const url = days
    ? `http://localhost:3000/api/analytics?days=${days}`
    : 'http://localhost:3000/api/analytics';
  const request = new NextRequest(url);
  request.headers.set('Authorization', 'Bearer test-token');
  return request;
}

describe('GET /api/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date('2026-08-15T00:00:00.000Z'));
    getDatabaseMock.mockReturnValue({ jobs: { getAllByUserId: getAllByUserIdMock } });
    getAllByUserIdMock.mockResolvedValue([]);
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-1',
      userName: 'User',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves the report without touching Supabase', async () => {
    // Regression: the route called createServerClient() unconditionally, which
    // throws without Supabase config, so the whole Reports page answered 500 in
    // a self-hosted SQLite install. packaging_jobs exists in both backends.
    getAllByUserIdMock.mockResolvedValue([
      makeJob({ id: 'a', status: 'completed' }),
      makeJob({ id: 'b', status: 'completed' }),
      makeJob({ id: 'c', status: 'failed', error_message: 'boom' }),
    ]);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    // Two of three finished jobs succeeded.
    expect(body.summary.successRate).toBe(67);
    expect(body.summary.totalJobs).toBe(3);
    expect(body.summary.failedJobs).toBe(1);
    expect(getAllByUserIdMock).toHaveBeenCalledWith('user-1');
  });

  it('counts only jobs inside the requested window', async () => {
    getAllByUserIdMock.mockResolvedValue([
      makeJob({ id: 'recent', created_at: '2026-08-14T10:00:00.000Z' }),
      makeJob({ id: 'old', created_at: '2026-06-01T10:00:00.000Z' }),
    ]);

    const body = await (await GET(makeRequest(7))).json();

    // The 7-day window starts 2026-08-08, so the June job must not count.
    expect(body.summary.totalJobs).toBe(1);
    expect(body.dateRange.days).toBe(7);
  });

  it('returns 401 without valid auth', async () => {
    parseAccessTokenMock.mockResolvedValue(null);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(getAllByUserIdMock).not.toHaveBeenCalled();
  });
});
