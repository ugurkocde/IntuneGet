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
  parseAccessToken: async () => ({ userId: 'msp-admin', userEmail: 'admin@example.com' }),
}));
vi.mock('@/lib/audit-logger', () => ({ createAuditLog: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase', () => ({ createServerClient: () => fixture.client }));

import { POST } from './route';
import { PUT } from './[id]/route';
import { POST as TEST } from './[id]/test/route';

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const NOT_PUBLIC = { error: 'Webhook URL must point to a host on the public internet' };
const BODY_MARKER = 'INTERNAL-RESPONSE-BODY';
const context = { params: Promise.resolve({ id: 'msp-webhook' }) };

type Write = { table: string; operation: 'insert' | 'update'; values: Record<string, unknown> };

/** Chainable Supabase stand-in: the caller is an owner and one webhook exists. */
function storage(webhookRow: Record<string, unknown>) {
  const writes: Write[] = [];
  const rows: Record<string, Record<string, unknown>> = {
    msp_user_memberships: { msp_organization_id: 'org-1', role: 'owner' },
    msp_webhook_configurations: webhookRow,
  };
  fixture.client = {
    from: (table: string) => {
      const result = { data: rows[table] ?? null, error: null, count: 0 };
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

const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/msp/webhooks', {
  method,
  headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const stored = (url: string) => ({
  id: 'msp-webhook', organization_id: 'org-1', name: 'Fixture', url, secret: null,
  event_types: ['deployment.completed'], headers: {}, is_enabled: true, failure_count: 0,
});
const create = (url: string) => ({ name: 'Fixture', url, event_types: ['deployment.completed'] });

const refused: Array<[string, string]> = [
  ['loopback', 'https://127.0.0.1/hook'],
  ['10.x', 'https://10.0.0.8/hook'],
  ['172.16.x', 'https://172.16.0.9/hook'],
  ['192.168.x', 'https://192.168.0.10/hook'],
  ['link-local metadata', 'https://169.254.169.254/latest/meta-data/'],
  ['100.64.x', 'https://100.64.1.1/hook'],
  ['::1', 'https://[::1]/hook'],
  ['fc00::/7', 'https://[fc00::1]/hook'],
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

describe('creating an MSP webhook', () => {
  it.each(refused)('refuses a %s destination', async (_label, url) => {
    const writes = storage(stored(url));
    const response = await POST(json('POST', create(url)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(NOT_PUBLIC);
    expect(writes).toEqual([]);
  });

  it.each([
    ['a private address', [{ address: '10.0.0.8', family: 4 }]],
    ['one public and one private record', [...PUBLIC, { address: '192.168.0.10', family: 4 }]],
  ])('refuses a hostname that resolves to %s', async (_label, addresses) => {
    lookupMock.mockResolvedValue(addresses);
    const writes = storage(stored('https://intranet.example.com/hook'));
    const response = await POST(json('POST', create('https://intranet.example.com/hook')));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(NOT_PUBLIC);
    expect(writes).toEqual([]);
  });

  it.each([
    ['http://hooks.example.com/hook', 'URL must use HTTPS'],
    ['https://user:pass@hooks.example.com/hook', 'URL must not contain credentials'],
    ['not a url', 'Invalid URL format'],
  ])('refuses %s', async (url, error) => {
    const writes = storage(stored(url));
    const response = await POST(json('POST', create(url)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(writes).toEqual([]);
  });

  it.each([
    'https://hooks.slack.com/services/T000/B000/XXXX',
    'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=xyz',
    'https://discord.com/api/webhooks/123/abc',
    'https://hooks.example.com/custom',
  ])('stores %s when it resolves to a public address', async (url) => {
    const writes = storage(stored(url));
    const response = await POST(json('POST', create(url)));
    expect(response.status).toBe(200);
    expect(writes).toEqual([
      { table: 'msp_webhook_configurations', operation: 'insert', values: expect.objectContaining({ url }) },
    ]);
  });
});

describe('updating an MSP webhook', () => {
  it.each(refused)('refuses a %s destination', async (_label, url) => {
    const writes = storage(stored('https://hooks.example.com/hook'));
    const response = await PUT(json('PUT', { url }), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(NOT_PUBLIC);
    expect(writes).toEqual([]);
  });

  it('refuses a hostname with one public and one private record', async () => {
    lookupMock.mockResolvedValue([...PUBLIC, { address: '10.0.0.8', family: 4 }]);
    const writes = storage(stored('https://hooks.example.com/hook'));
    const response = await PUT(json('PUT', { url: 'https://mixed.example.com/hook' }), context);
    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it('stores a public destination', async () => {
    const writes = storage(stored('https://hooks.example.com/hook'));
    const response = await PUT(json('PUT', { url: 'https://hooks.example.com/new' }), context);
    expect(response.status).toBe(200);
    expect(writes).toEqual([
      { table: 'msp_webhook_configurations', operation: 'update', values: { url: 'https://hooks.example.com/new' } },
    ]);
  });
});

describe('testing an MSP webhook', () => {
  it('returns the outcome and status code without any response text', async () => {
    storage(stored('https://hooks.example.com/hook'));
    respond({ statusCode: 500, body: BODY_MARKER });
    const response = await TEST(json('POST'), context);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ success: false, message: 'HTTP 500', response_status: 500 });
    expect(text).not.toContain(BODY_MARKER);
  });

  it('returns success for a public host without any response text', async () => {
    storage(stored('https://hooks.example.com/hook'));
    respond({ statusCode: 200, body: BODY_MARKER });
    const response = await TEST(json('POST'), context);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      success: true,
      message: 'Test webhook delivered successfully',
      response_status: 200,
    });
    expect(text).not.toContain(BODY_MARKER);
    expect(requestMock.mock.calls[0][0]).toMatchObject({ hostname: '93.184.216.34', servername: 'hooks.example.com' });
  });

  it('refuses a stored private destination without sending', async () => {
    storage(stored('https://169.254.169.254/latest/meta-data/'));
    const response = await TEST(json('POST'), context);
    expect(await response.json()).toEqual({ success: false, message: NOT_PUBLIC.error });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('reports a 302 as a failure and does not follow it', async () => {
    storage(stored('https://hooks.example.com/hook'));
    respond({ statusCode: 302, headers: { location: 'https://10.0.0.8/' }, body: BODY_MARKER });
    const response = await TEST(json('POST'), context);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      success: false,
      message: 'HTTP 302: redirects are not followed',
      response_status: 302,
    });
    expect(text).not.toContain(BODY_MARKER);
    expect(requestMock).toHaveBeenCalledOnce();
  });
});
