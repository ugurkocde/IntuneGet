import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  createServerClient: vi.fn(),
  isSupabaseServerConfigured: () => false,
}));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn().mockResolvedValue(null),
  getIpKey: vi.fn(),
  getUserKey: vi.fn(),
  SUGGESTION_RATE_LIMIT: {},
  PUBLIC_RATE_LIMIT: {},
}));

import { GET } from './route';

describe('GET /api/community/suggestions', () => {
  it('returns an empty list without hosted services', async () => {
    const response = await GET(new NextRequest('http://localhost/api/community/suggestions'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suggestions: [],
      userVotes: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });
});
