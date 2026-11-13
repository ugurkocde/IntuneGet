import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock, lookupMock, createServerClientMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  lookupMock: vi.fn(),
  createServerClientMock: vi.fn(),
}));
vi.mock('node:https', () => ({ request: requestMock }));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));
vi.mock('@/lib/supabase', () => ({ createServerClient: createServerClientMock }));

import { queueWebhookDelivery, sendTestWebhook } from './webhook-service';

type Reply = { statusCode: number; headers?: Record<string, string>; body?: string };

function respond(reply: Reply) {
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

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const NOT_PUBLIC = 'Webhook URL must point to a host on the public internet';
const BODY_MARKER = 'INTERNAL-RESPONSE-BODY';

const webhook = (url: string) => ({
  id: 'msp-webhook-1',
  organization_id: 'org-1',
  name: 'Fixture webhook',
  url,
  secret: 'shared-secret',
  event_types: ['deployment.completed'],
  headers: { 'X-Team': 'ops' },
  is_enabled: true,
  failure_count: 0,
});

/**
 * Minimal Supabase stand-in for queueWebhookDelivery: one enabled webhook,
 * one pending delivery, and a record of every update that is written.
 */
function supabaseWith(configuredWebhook: ReturnType<typeof webhook>) {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const client = {
    from: (table: string) => ({
      select: () => {
        const chain: Record<string, unknown> = {};
        const terminal = table === 'msp_webhook_configurations'
          ? { data: [configuredWebhook], error: null }
          : { data: { id: 'delivery-1', attempts: 0, max_attempts: 3 }, error: null };
        for (const method of ['eq', 'order', 'limit']) chain[method] = () => chain;
        chain.contains = async () => terminal;
        chain.single = async () => terminal;
        return chain;
      },
      insert: async () => ({ error: null }),
      update: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  createServerClientMock.mockReturnValue(client);
  return updates;
}

async function settle() {
  // Delivery is fire and forget inside queueWebhookDelivery.
  await vi.waitFor(() => expect(createServerClientMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  requestMock.mockReset();
  lookupMock.mockReset();
  createServerClientMock.mockReset();
  lookupMock.mockResolvedValue(PUBLIC);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('fetch must not be used for webhooks'); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('MSP sendTestWebhook', () => {
  it.each([
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
  ])('refuses %s', async (_label, url) => {
    expect(await sendTestWebhook(webhook(url))).toEqual({ success: false, message: NOT_PUBLIC });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('refuses a hostname that resolves to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.8', family: 4 }]);
    expect(await sendTestWebhook(webhook('https://intranet.example.com/hook'))).toEqual({ success: false, message: NOT_PUBLIC });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('refuses a hostname with one public and one private record', async () => {
    lookupMock.mockResolvedValue([...PUBLIC, { address: '192.168.0.10', family: 4 }]);
    expect(await sendTestWebhook(webhook('https://mixed.example.com/hook'))).toEqual({ success: false, message: NOT_PUBLIC });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('reports a 302 as a failure without following it', async () => {
    respond({ statusCode: 302, headers: { location: 'https://10.0.0.8/' }, body: BODY_MARKER });
    expect(await sendTestWebhook(webhook('https://hooks.example.com/hook'))).toEqual({
      success: false,
      message: 'HTTP 302: redirects are not followed',
      response_status: 302,
    });
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it('succeeds for a public host through the validated address', async () => {
    respond({ statusCode: 200, body: BODY_MARKER });
    expect(await sendTestWebhook(webhook('https://hooks.example.com/hook'))).toEqual({
      success: true,
      message: 'Test webhook delivered successfully',
      response_status: 200,
    });
    const options = requestMock.mock.calls[0][0];
    expect(options).toMatchObject({ hostname: '93.184.216.34', servername: 'hooks.example.com', method: 'POST' });
    expect(options.headers).toMatchObject({ Host: 'hooks.example.com', 'X-Team': 'ops' });
    expect(options.headers['X-IntuneGet-Signature']).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([401, 404, 500])('returns the status code and no response text for HTTP %i', async (statusCode) => {
    respond({ statusCode, body: BODY_MARKER });
    const result = await sendTestWebhook(webhook('https://hooks.example.com/hook'));
    expect(result).toEqual({ success: false, message: `HTTP ${statusCode}`, response_status: statusCode });
    expect(JSON.stringify(result)).not.toContain(BODY_MARKER);
  });
});

describe('MSP queued delivery', () => {
  it('records a refused destination as a failed attempt without sending', async () => {
    const updates = supabaseWith(webhook('https://169.254.169.254/latest/meta-data/'));
    await queueWebhookDelivery('org-1', 'deployment.completed', { job: 'fixture' });
    await settle();

    expect(requestMock).not.toHaveBeenCalled();
    expect(updates).toEqual([
      { table: 'msp_webhook_deliveries', values: expect.objectContaining({ attempts: 1, error_message: NOT_PUBLIC }) },
    ]);
  });

  it('records a redirect as a failed attempt and does not follow it', async () => {
    const updates = supabaseWith(webhook('https://hooks.example.com/hook'));
    respond({ statusCode: 307, headers: { location: 'https://10.0.0.8/' } });
    await queueWebhookDelivery('org-1', 'deployment.completed', { job: 'fixture' });
    await settle();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(updates[0]).toEqual({
      table: 'msp_webhook_deliveries',
      values: expect.objectContaining({
        attempts: 1,
        response_status: 307,
        error_message: 'HTTP 307: redirects are not followed',
      }),
    });
  });

  it('delivers to a public host and records success', async () => {
    const updates = supabaseWith(webhook('https://hooks.example.com/hook'));
    respond({ statusCode: 200, body: 'accepted' });
    await queueWebhookDelivery('org-1', 'deployment.completed', { job: 'fixture' });
    await settle();

    expect(requestMock.mock.calls[0][0]).toMatchObject({ hostname: '93.184.216.34', servername: 'hooks.example.com' });
    expect(updates[0]).toEqual({
      table: 'msp_webhook_deliveries',
      values: expect.objectContaining({ status: 'success', attempts: 1, response_status: 200, response_body: 'accepted' }),
    });
    expect(updates[1]).toEqual({
      table: 'msp_webhook_configurations',
      values: expect.objectContaining({ failure_count: 0 }),
    });
  });
});
