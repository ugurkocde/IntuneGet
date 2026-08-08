import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock, createServerClientMock, applyRateLimitMock, applyStrictRateLimitMock } = vi.hoisted(() => {
  const rpc = vi.fn();
  return {
    rpcMock: rpc,
    createServerClientMock: vi.fn(() => ({ rpc })),
    applyRateLimitMock: vi.fn().mockResolvedValue(null),
    applyStrictRateLimitMock: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('@/lib/supabase', () => ({ createServerClient: createServerClientMock }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: applyRateLimitMock,
  applyStrictRateLimit: applyStrictRateLimitMock,
  getIpKey: () => 'ip:test',
  QA_LIVE_FRAME_RATE_LIMIT: { limit: 240, windowMs: 60_000 },
  QA_LIVE_INGEST_RATE_LIMIT: { limit: 60, windowMs: 60_000 },
}));

import { DELETE, GET, POST } from './route';

const candidateId = '11111111-1111-4111-8111-111111111111';

describe('/api/qa/live/frame ingest boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects malformed frame metadata before reading or storing the body', async () => {
    const response = await POST(new Request('https://intuneget.com/api/qa/live/frame', {
      method: 'POST',
      headers: {
        authorization: 'Bearer this-is-a-long-enough-test-secret',
        'x-qa-candidate-id': candidateId,
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid frame metadata' });
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it('does not coerce a missing frame slot header to slot zero', async () => {
    const response = await POST(new Request('https://www.intuneget.com/api/qa/live/frame', {
      method: 'POST',
      headers: {
        authorization: 'Bearer this-is-a-long-enough-test-secret',
        'x-qa-candidate-id': candidateId,
        'x-qa-captured-at': new Date().toISOString(),
        'x-qa-frame-sequence': '1',
        'x-qa-frame-width': '1280',
        'x-qa-frame-height': '720',
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    }));

    expect(response.status).toBe(400);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it('requires a candidate-bound public frame request', async () => {
    const response = await GET(new Request('https://intuneget.com/api/qa/live/frame'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid candidate' });
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it('requires the immutable frame sequence in the public URL', async () => {
    const response = await GET(new Request(`https://www.intuneget.com/api/qa/live/frame?candidate=${candidateId}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid sequence' });
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it('returns a quiet 404 when cleanup removes the object after metadata is read', async () => {
    const chain = (result: unknown) => {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        in: vi.fn(),
        order: vi.fn(),
        limit: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue(result),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.in.mockReturnValue(query);
      query.order.mockReturnValue(query);
      query.limit.mockReturnValue(query);
      return query;
    };
    const activeQuery = chain({ data: { id: candidateId }, error: null });
    const frameQuery = chain({
      data: {
        object_path: `${candidateId}/slot-1.jpg`,
        captured_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sequence: 42,
      },
      error: null,
    });
    const from = vi.fn()
      .mockReturnValueOnce(activeQuery)
      .mockReturnValueOnce(frameQuery);
    const download = vi.fn().mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    createServerClientMock.mockReturnValueOnce({
      rpc: rpcMock,
      from,
      storage: { from: vi.fn(() => ({ download })) },
    } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await GET(new Request(
      `https://www.intuneget.com/api/qa/live/frame?candidate=${candidateId}&sequence=42`
    ));

    expect(response.status).toBe(404);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('requires the QA-only secret and an active exact-package candidate', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const response = await POST(new Request('https://intuneget.com/api/qa/live/frame', {
      method: 'POST',
      headers: {
        authorization: 'Bearer this-is-a-long-enough-test-secret',
        'x-qa-candidate-id': candidateId,
        'x-qa-captured-at': new Date().toISOString(),
        'x-qa-frame-sequence': '1',
        'x-qa-frame-width': '1280',
        'x-qa-frame-height': '720',
        'x-qa-frame-slot': '1',
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    }));

    expect(response.status).toBe(401);
    expect(rpcMock).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('does not allow unauthenticated cleanup', async () => {
    const response = await DELETE(new Request('https://intuneget.com/api/qa/live/frame', {
      method: 'DELETE',
      headers: { 'x-qa-candidate-id': candidateId },
    }));

    expect(response.status).toBe(401);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });
});
