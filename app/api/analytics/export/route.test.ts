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

import { GET } from '@/app/api/analytics/export/route';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    winget_id: 'Microsoft.Edge',
    display_name: 'Edge',
    publisher: 'Microsoft',
    version: '120.0',
    architecture: 'x64',
    installer_type: 'exe',
    status: 'deployed',
    error_message: null,
    intune_app_id: 'intune-1',
    created_at: '2026-08-10T10:00:00.000Z',
    completed_at: '2026-08-10T10:05:00.000Z',
    ...overrides,
  };
}

function makeRequest(days?: number) {
  const url = days
    ? `http://localhost:3000/api/analytics/export?days=${days}`
    : 'http://localhost:3000/api/analytics/export';
  const request = new NextRequest(url);
  request.headers.set('Authorization', 'Bearer test-token');
  return request;
}

describe('GET /api/analytics/export', () => {
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

  it('exports CSV without touching Supabase', async () => {
    // Regression: the route called createServerClient() unconditionally, which
    // throws without Supabase config, so the export button answered 500 in a
    // self-hosted SQLite install.
    getAllByUserIdMock.mockResolvedValue([makeJob()]);

    const response = await GET(makeRequest());
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('csv');
    expect(csv).toContain('Winget ID');
    expect(csv).toContain('Microsoft.Edge');
    expect(getAllByUserIdMock).toHaveBeenCalledWith('user-1');
  });

  it('exports only jobs inside the requested window', async () => {
    getAllByUserIdMock.mockResolvedValue([
      makeJob({ id: 'recent', winget_id: 'In.Window', created_at: '2026-08-14T10:00:00.000Z' }),
      makeJob({ id: 'old', winget_id: 'Out.Of.Window', created_at: '2026-06-01T10:00:00.000Z' }),
    ]);

    const csv = await (await GET(makeRequest(7))).text();

    expect(csv).toContain('In.Window');
    expect(csv).not.toContain('Out.Of.Window');
  });

  it('returns 401 without valid auth', async () => {
    parseAccessTokenMock.mockResolvedValue(null);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(getAllByUserIdMock).not.toHaveBeenCalled();
  });
});
