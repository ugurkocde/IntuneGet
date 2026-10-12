import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const { parseAccessTokenMock, getServerClientOrNullMock } = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  getServerClientOrNullMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  getServerClientOrNull: getServerClientOrNullMock,
}));

import { GET } from '@/app/api/intune/esp-profiles/route';

describe('GET /api/intune/esp-profiles', () => {
  it('returns an empty profile list when Supabase server access is not configured', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      userEmail: 'user@example.com',
    });
    getServerClientOrNullMock.mockReturnValue(null);

    const response = await GET(new NextRequest('http://localhost/api/intune/esp-profiles'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ profiles: [], count: 0 });
  });
});
