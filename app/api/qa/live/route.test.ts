import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getQaLiveSnapshotMock, applyRateLimitMock } = vi.hoisted(() => ({
  getQaLiveSnapshotMock: vi.fn(),
  applyRateLimitMock: vi.fn(),
}));

vi.mock('@/lib/qa/live', () => ({ getQaLiveSnapshot: getQaLiveSnapshotMock }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: applyRateLimitMock,
  getIpKey: () => 'ip:test',
  QA_LIVE_RATE_LIMIT: { limit: 90, windowMs: 60_000 },
}));

import { GET } from './route';

describe('GET /api/qa/live', () => {
  beforeEach(() => {
    applyRateLimitMock.mockReset().mockResolvedValue(null);
    getQaLiveSnapshotMock.mockReset().mockResolvedValue({ active: false, current: null });
  });

  it('is never cached', async () => {
    const response = await GET(new NextRequest('http://localhost/api/qa/live'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns a sanitized unavailable response on server errors', async () => {
    getQaLiveSnapshotMock.mockRejectedValue(new Error('private database detail'));
    const response = await GET(new NextRequest('http://localhost/api/qa/live'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Live QA status is temporarily unavailable' });
  });
});
