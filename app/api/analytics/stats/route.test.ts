import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: vi.fn().mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1' }),
}));
vi.mock('@/lib/db', () => ({
  getDatabase: () => ({ jobs: { getByUserId: vi.fn().mockResolvedValue([]) } }),
}));

import { GET } from './route';

describe('GET /api/analytics/stats', () => {
  it('returns a well-formed zero payload with no SQLite jobs', async () => {
    const response = await GET(new NextRequest('http://localhost/api/analytics/stats'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      totalDeployed: 0,
      thisMonth: 0,
      pending: 0,
      failed: 0,
      recentActivity: [],
    });
  });
});
