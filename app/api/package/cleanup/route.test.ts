import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const createServerClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ createServerClient }));

import { GET, POST } from './route';

const handlers: Array<[string, (request: NextRequest) => Promise<Response>]> = [
  ['POST', POST],
  ['GET', GET],
];

const request = (method: string, authorization?: string) => new NextRequest('http://localhost/api/package/cleanup', {
  method,
  headers: authorization === undefined ? {} : { Authorization: authorization },
});

/** Supabase stand-in that reports no jobs for either handler. */
function emptyStorage() {
  const result = { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'in', 'lt', 'eq', 'order', 'limit']) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
  createServerClient.mockReturnValue({ from: () => chain });
}

beforeEach(() => {
  createServerClient.mockReset();
  createServerClient.mockImplementation(() => { throw new Error('cleanup must not reach storage'); });
  vi.stubEnv('CLEANUP_SECRET', undefined);
  vi.stubEnv('CALLBACK_SECRET', undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe.each(handlers)('package cleanup %s', (method, handler) => {
  it('rejects every request when no secret is configured', async () => {
    for (const authorization of [undefined, 'Bearer undefined', 'Bearer ', 'Bearer anything']) {
      const response = await handler(request(method, authorization));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized' });
    }
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('rejects every request when the secrets are empty', async () => {
    vi.stubEnv('CLEANUP_SECRET', '');
    vi.stubEnv('CALLBACK_SECRET', '');
    for (const authorization of [undefined, 'Bearer undefined', 'Bearer ']) {
      expect((await handler(request(method, authorization))).status).toBe(401);
    }
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('rejects a missing header and a wrong value of the same length', async () => {
    vi.stubEnv('CLEANUP_SECRET', 'cleanup-secret');
    for (const authorization of [undefined, 'Bearer cleanup-secreT', 'Bearer undefined']) {
      expect((await handler(request(method, authorization))).status).toBe(401);
    }
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('accepts the cleanup secret', async () => {
    vi.stubEnv('CLEANUP_SECRET', 'cleanup-secret');
    emptyStorage();
    const response = await handler(request(method, 'Bearer cleanup-secret'));
    expect(response.status).toBe(200);
    expect(createServerClient).toHaveBeenCalledOnce();
  });

  it('falls back to the callback secret', async () => {
    vi.stubEnv('CALLBACK_SECRET', 'callback-secret');
    emptyStorage();
    expect((await handler(request(method, 'Bearer callback-secret'))).status).toBe(200);
    expect((await handler(request(method, 'Bearer cleanup-secret'))).status).toBe(401);
  });
});
