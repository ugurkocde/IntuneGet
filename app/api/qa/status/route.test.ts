import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getQaStatusesMock, applyRateLimitMock } = vi.hoisted(() => ({
  getQaStatusesMock: vi.fn(),
  applyRateLimitMock: vi.fn(),
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSource: () => ({ getQaStatuses: getQaStatusesMock }),
}));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: applyRateLimitMock,
  getIpKey: () => 'ip:test',
  PUBLIC_RATE_LIMIT: { limit: 30, windowMs: 60_000 },
}));

import { GET } from './route';

describe('GET /api/qa/status', () => {
  beforeEach(() => {
    getQaStatusesMock.mockReset();
    applyRateLimitMock.mockReset().mockResolvedValue(null);
  });

  it('returns one compact status map with nulls for untested IDs', async () => {
    getQaStatusesMock.mockResolvedValue([
      {
        winget_id: 'OpenJS.NodeJS',
        outcome: 'Passed',
        tested_version: '26.7.0',
        architecture: 'x64',
        tested_at_utc: '2026-08-07T12:00:00Z',
      },
    ]);
    const response = await GET(
      new NextRequest('http://localhost/api/qa/status?ids=OpenJS.NodeJS,Mozilla.Firefox')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
    expect(body.statuses['OpenJS.NodeJS']).toMatchObject({ outcome: 'Passed', testedVersion: '26.7.0' });
    expect(body.statuses['Mozilla.Firefox']).toBeNull();
  });

  it('returns null for unsupported Store IDs without poisoning valid IDs', async () => {
    getQaStatusesMock.mockResolvedValue([]);
    const invalid = await GET(new NextRequest('http://localhost/api/qa/status?ids=not-an-id'));
    const mixed = await GET(
      new NextRequest('http://localhost/api/qa/status?ids=OpenJS.NodeJS,9NBLGGH4NNS1')
    );
    expect(invalid.status).toBe(200);
    expect((await invalid.json()).statuses['not-an-id']).toBeNull();
    expect(mixed.status).toBe(200);
    expect((await mixed.json()).statuses['9NBLGGH4NNS1']).toBeNull();
    expect(getQaStatusesMock).toHaveBeenCalledWith(['OpenJS.NodeJS']);
  });

  it('rejects oversized ID sets before querying the catalog', async () => {
    const tooMany = Array.from({ length: 101 }, (_, index) => `Vendor.App${index}`).join(',');
    const oversized = await GET(new NextRequest(`http://localhost/api/qa/status?ids=${tooMany}`));
    expect(oversized.status).toBe(400);
    expect(getQaStatusesMock).not.toHaveBeenCalled();
  });
});
