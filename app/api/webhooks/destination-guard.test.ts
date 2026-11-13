import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requestMock, lookupMock, fixture } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  lookupMock: vi.fn(),
  fixture: { client: null as unknown },
}));
vi.mock('node:https', () => ({ request: requestMock }));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));
vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: async () => ({ userId: 'local-webhook-owner' }),
}));
vi.mock('@/lib/supabase', () => ({
  isSupabaseServerConfigured: () => true,
  createServerClient: () => fixture.client,
}));

import { POST } from './route';
import { PUT } from './[id]/route';
import { POST as TEST } from './[id]/test/route';

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const NOT_PUBLIC = { error: 'Webhook URL must point to a host on the public internet' };
const BODY_MARKER = 'INTERNAL-RESPONSE-BODY';
const context = { params: Promise.resolve({ id: 'local-webhook' }) };

type Write = { table: string; operation: 'insert' | 'update'; values: Record<string, unknown> };

/** Chainable Supabase stand-in: every query on a table resolves to one row. */
function storage(row: Record<string, unknown> | null) {
  const writes: Write[] = [];
  const result = { data: row, error: row ? null : { code: 'PGRST116' }, count: 0 };
  fixture.client = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit']) chain[method] = () => chain;
      chain.insert = (values: Record<string, unknown>) => { writes.push({ table, operation: 'insert', values }); return chain; };
      chain.update = (values: Record<string, unknown>) => { writes.push({ table, operation: 'update', values }); return chain; };
      chain.single = async () => result;
      chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
      return chain;
    },
  };
  return writes;
}

function respond(reply: { statusCode: number; headers?: Record<string, string>; body?: string }) {
  requestMock.mockImplementationOnce((_options, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      const response = Object.assign(new PassThrough(), { statusCode: reply.statusCode, headers: reply.headers ?? {} });
      callback(response);
      if (!response.destroyed) response.end(reply.body);
    });
    return request;
  });
}

const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/webhooks', {
  method,
  headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const refused: Array<[string, string]> = [
  ['loopback', 'https://127.0.0.1/hook'],
  ['10.x', 'https://10.0.0.8/hook'],
  ['172.16.x', 'https://172.16.0.9/hook'],
  ['192.168.x', 'https://192.168.0.10/hook'],
  ['link-local metadata', 'https://169.254.169.254/latest/meta-data/'],
  ['100.64.x', 'https://100.64.1.1/hook'],
  ['::1', 'https://[::1]/hook'],
  ['fc00::/7', 'https://[fd00::1]/hook'],
  ['fe80::/10', 'https://[fe80::1]/hook'],
  ['IPv4-mapped IPv6 of a private address', 'https://[::ffff:10.0.0.8]/hook'],
];

beforeEach(() => {
  requestMock.mockReset();
  lookupMock.mockReset();
  lookupMock.mockResolvedValue(PUBLIC);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in route tests'); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('creating a webhook', () => {
  it.each(refused)('refuses a %s destination', async (_label, url) => {
    const writes = storage({ id: 'local-webhook', secret: null });
    const response = await POST(json('POST', { name: 'Fixture', url, webhook_type: 'custom' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(NOT_PUBLIC);
    expect(writes).toEqual([]);
  });

  it.each([
    ['a private address', [{ address: '10.0.0.8', family: 4 }]],
    ['one public and one private record', [...PUBLIC, { address: '192.168.0.10', family: 4 }]],
  ])('refuses a hostname that resolves to %s', async (_label, addresses) => {
    lookupMock.mockResolvedValue(addresses);
    const writes = storage({ id: 'local-webhook', secret: null });
    const response = await POST(json('POST', { name: 'Fixture', url: 'https://intranet.example.com/hook', webhook_type: 'custom' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(NOT_PUBLIC);
    expect(writes).toEqual([]);
  });

  it('refuses credentials in the URL', async () => {
    const writes = storage({ id: 'local-webhook', secret: null });
    const response = await POST(json('POST', { name: 'Fixture', url: 'https://user:pass@hooks.example.com/hook', webhook_type: 'custom' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'URL must not contain credentials' });
    expect(writes).toEqual([]);
  });

  it.each([
    'https://hooks.slack.com/services/T000/B000/XXXX',
    'https://example.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi',
    'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=xyz',
    'https://discord.com/api/webhooks/123/abc',
    'https://hooks.example.com/custom',
  ])('stores %s when it resolves to a public address', async (url) => {
    const writes = storage({ id: 'local-webhook', secret: null });
    const response = await POST(json('POST', { name: 'Fixture', url }));
    expect(response.status).toBe(201);
    expect(writes).toEqual([
      { table: 'webhook_configurations', operation: 'insert', values: expect.objectContaining({ url }) },
    ]);
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('updating a webhook', () => {
  it.each(refused)('refuses a %s destination', async (_label, url) => {
    const writes = storage({ id: 'local-webhook', secret: null });
    const response = await PUT(json('PUT', { url }), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(NOT_PUBLIC);
    expect(writes).toEqual([]);
  });

  it('refuses a hostname that resolves to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '172.16.0.9', family: 4 }]);
    const writes = storage({ id: 'local-webhook', secret: null });
    const response = await PUT(json('PUT', { url: 'https://intranet.example.com/hook' }), context);
    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it('refuses an empty URL instead of storing it', async () => {
    const writes = storage({ id: 'local-webhook', secret: null });
    const response = await PUT(json('PUT', { url: '' }), context);
    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it('stores a public destination', async () => {
    const writes = storage({ id: 'local-webhook', secret: null });
    const response = await PUT(json('PUT', { url: 'https://hooks.example.com/new' }), context);
    expect(response.status).toBe(200);
    expect(writes[0]).toMatchObject({ operation: 'update', values: { url: 'https://hooks.example.com/new' } });
  });

  it('does not resolve anything when the URL is not part of the update', async () => {
    storage({ id: 'local-webhook', secret: null });
    const response = await PUT(json('PUT', { name: 'Renamed' }), context);
    expect(response.status).toBe(200);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe('testing a webhook', () => {
  const stored = (url: string) => ({
    id: 'local-webhook', user_id: 'local-webhook-owner', name: 'Fixture', url, webhook_type: 'custom',
    secret: null, headers: {}, is_enabled: true, failure_count: 0,
  });

  it('returns the outcome and status code without any response text', async () => {
    const writes = storage(stored('https://hooks.example.com/hook'));
    respond({ statusCode: 500, body: BODY_MARKER });
    const response = await TEST(json('POST'), context);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ success: false, statusCode: 500, error: 'HTTP 500' });
    expect(text).not.toContain(BODY_MARKER);
    expect(writes[0]).toMatchObject({ operation: 'update', values: { failure_count: 1 } });
  });

  it('returns success for a public host without any response text', async () => {
    storage(stored('https://hooks.example.com/hook'));
    respond({ statusCode: 200, body: BODY_MARKER });
    const response = await TEST(json('POST'), context);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ success: true, statusCode: 200 });
    expect(text).not.toContain(BODY_MARKER);
    expect(requestMock.mock.calls[0][0]).toMatchObject({ hostname: '93.184.216.34', servername: 'hooks.example.com' });
  });

  it('refuses a stored private destination without sending', async () => {
    storage(stored('https://169.254.169.254/latest/meta-data/'));
    const response = await TEST(json('POST'), context);
    expect(await response.json()).toEqual({ success: false, error: NOT_PUBLIC.error });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('refuses a stored hostname that now resolves to a private address', async () => {
    storage(stored('https://rebind.example.com/hook'));
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const response = await TEST(json('POST'), context);
    expect(await response.json()).toEqual({ success: false, error: NOT_PUBLIC.error });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('reports a 302 as a failure and does not follow it', async () => {
    storage(stored('https://hooks.example.com/hook'));
    respond({ statusCode: 302, headers: { location: 'https://10.0.0.8/' }, body: BODY_MARKER });
    const response = await TEST(json('POST'), context);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ success: false, statusCode: 302, error: 'HTTP 302: redirects are not followed' });
    expect(text).not.toContain(BODY_MARKER);
    expect(requestMock).toHaveBeenCalledOnce();
  });
});
