import { NextRequest } from 'next/server';

const { parseAccessTokenMock, getServerClientOrNullMock } = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  getServerClientOrNullMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: parseAccessTokenMock }));
vi.mock('@/lib/supabase', () => ({ getServerClientOrNull: getServerClientOrNullMock }));

import { GET } from './route';

describe('GET /api/notifications/unread-count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseAccessTokenMock.mockResolvedValue({ userId: 'test-user' });
    getServerClientOrNullMock.mockReturnValue(null);
  });

  function request() {
    return new NextRequest('http://localhost/api/notifications/unread-count');
  }

  it('returns the unread count contract when Supabase is unavailable', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unread_count: 0 });
  });

  it('returns the configured database count for the authenticated user', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn().mockResolvedValue({ count: 3, error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const from = vi.fn().mockReturnValue(query);
    getServerClientOrNullMock.mockReturnValue({ from });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unread_count: 3 });
    expect(from).toHaveBeenCalledWith('user_notifications');
    expect(query.select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
    expect(query.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(query.is).toHaveBeenCalledWith('read_at', null);
  });

  it('requires authentication before initializing the database client', async () => {
    parseAccessTokenMock.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentication required' });
    expect(getServerClientOrNullMock).not.toHaveBeenCalled();
  });
});
