import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock, lookupMock } = vi.hoisted(() => ({ requestMock: vi.fn(), lookupMock: vi.fn() }));
vi.mock('node:https', () => ({ request: requestMock }));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import { deliverWebhook, sendTestWebhook, validateWebhookUrl } from './service';
import type { NotificationPayload, WebhookConfiguration } from '@/types/notifications';

type Reply = { statusCode: number; headers?: Record<string, string>; body?: string };

function respond(...replies: Reply[]) {
  for (const reply of replies) {
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
}

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const NOT_PUBLIC = 'Webhook URL must point to a host on the public internet';
const BODY_MARKER = 'INTERNAL-RESPONSE-BODY';

const webhook = (url: string, overrides: Partial<WebhookConfiguration> = {}): WebhookConfiguration => ({
  id: 'webhook-1',
  user_id: 'user-1',
  name: 'Fixture webhook',
  url,
  webhook_type: 'custom',
  secret: null,
  headers: {},
  is_enabled: true,
  failure_count: 0,
  last_failure_at: null,
  last_success_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const payload: NotificationPayload = {
  event: 'app_updates_available',
  timestamp: '2026-01-01T00:00:00Z',
  tenant_id: 'tenant-1',
  updates: [],
  summary: { total: 0, critical: 0 },
};

const refusedLiterals: Array<[string, string]> = [
  ['loopback', 'https://127.0.0.1/hook'],
  ['10.x', 'https://10.0.0.8/hook'],
  ['172.16.x', 'https://172.16.0.9/hook'],
  ['192.168.x', 'https://192.168.0.10/hook'],
  ['link-local metadata', 'https://169.254.169.254/latest/meta-data/'],
  ['100.64.x', 'https://100.64.1.1/hook'],
  ['::1', 'https://[::1]/hook'],
  ['fc00::/7', 'https://[fd12:3456::1]/hook'],
  ['fe80::/10', 'https://[fe80::1]/hook'],
  ['IPv4-mapped IPv6 of a private address', 'https://[::ffff:192.168.0.10]/hook'],
];

beforeEach(() => {
  requestMock.mockReset();
  lookupMock.mockReset();
  lookupMock.mockResolvedValue(PUBLIC);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('fetch must not be used for webhooks'); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('deliverWebhook destination guard', () => {
  it.each(refusedLiterals)('refuses %s without sending or retrying', async (_label, url) => {
    const result = await deliverWebhook(webhook(url), payload, { retries: 3, retryDelay: 0 });
    expect(result).toEqual({ success: false, statusCode: undefined, error: NOT_PUBLIC, retryable: false });
    expect(requestMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('refuses a hostname that resolves to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.8', family: 4 }]);
    const result = await deliverWebhook(webhook('https://intranet.example.com/hook'), payload, { retryDelay: 0 });
    expect(result).toMatchObject({ success: false, error: NOT_PUBLIC, retryable: false });
    expect(requestMock).not.toHaveBeenCalled();
    expect(lookupMock).toHaveBeenCalledOnce();
  });

  it('refuses a hostname with one public and one private record', async () => {
    lookupMock.mockResolvedValue([...PUBLIC, { address: '192.168.0.10', family: 4 }]);
    const result = await deliverWebhook(webhook('https://mixed.example.com/hook'), payload, { retryDelay: 0 });
    expect(result).toMatchObject({ success: false, error: NOT_PUBLIC, retryable: false });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('refuses a stored URL that is not HTTPS or carries credentials', async () => {
    expect(await deliverWebhook(webhook('http://hooks.example.com/hook'), payload)).toMatchObject({
      success: false, error: 'URL must use HTTPS', retryable: false,
    });
    expect(await deliverWebhook(webhook('https://user:pass@hooks.example.com/hook'), payload)).toMatchObject({
      success: false, error: 'URL must not contain credentials', retryable: false,
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('treats a 302 as a failed delivery and does not follow or retry it', async () => {
    respond({ statusCode: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' }, body: BODY_MARKER });
    const result = await deliverWebhook(webhook('https://hooks.example.com/hook'), payload, { retries: 3, retryDelay: 0 });
    expect(result).toEqual({
      success: false,
      statusCode: 302,
      error: 'HTTP 302: redirects are not followed',
      retryable: false,
    });
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it('delivers to a public host through the validated address', async () => {
    respond({ statusCode: 200, body: 'ok' });
    const result = await deliverWebhook(
      webhook('https://hooks.example.com/hook', { secret: 'shared-secret', headers: { 'X-Team': 'ops' } }),
      payload,
    );
    expect(result).toEqual({ success: true, statusCode: 200 });

    const options = requestMock.mock.calls[0][0];
    expect(options).toMatchObject({ hostname: '93.184.216.34', servername: 'hooks.example.com', method: 'POST', path: '/hook' });
    expect(options.headers).toMatchObject({
      Host: 'hooks.example.com',
      'Content-Type': 'application/json',
      'User-Agent': 'IntuneGet-Webhook/1.0',
      'X-Team': 'ops',
    });
    expect(options.headers['X-Webhook-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('re-validates the destination on every retry', async () => {
    respond({ statusCode: 503 });
    lookupMock.mockResolvedValueOnce(PUBLIC).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const result = await deliverWebhook(webhook('https://rebind.example.com/hook'), payload, { retries: 2, retryDelay: 0 });
    expect(result).toMatchObject({ success: false, error: NOT_PUBLIC, retryable: false });
    expect(requestMock).toHaveBeenCalledOnce();
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying server errors and reports the last status', async () => {
    respond({ statusCode: 503 }, { statusCode: 502 });
    const result = await deliverWebhook(webhook('https://hooks.example.com/hook'), payload, { retries: 1, retryDelay: 0 });
    expect(result).toEqual({ success: false, statusCode: 502, error: 'HTTP 502', retryable: true });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('retries a failed lookup, which can be transient', async () => {
    respond({ statusCode: 200 });
    lookupMock.mockRejectedValueOnce(Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }))
      .mockResolvedValueOnce(PUBLIC);
    const result = await deliverWebhook(webhook('https://hooks.example.com/hook'), payload, { retries: 1, retryDelay: 0 });
    expect(result).toEqual({ success: true, statusCode: 200 });
  });

  it('does not retry a client error', async () => {
    respond({ statusCode: 404, body: 'no such hook' });
    const result = await deliverWebhook(webhook('https://hooks.example.com/hook'), payload, { retries: 3, retryDelay: 0 });
    expect(result).toEqual({ success: false, statusCode: 404, error: 'HTTP 404: no such hook', retryable: false });
    expect(requestMock).toHaveBeenCalledOnce();
  });
});

describe('sendTestWebhook', () => {
  it.each(refusedLiterals)('refuses %s', async (_label, url) => {
    expect(await sendTestWebhook(webhook(url))).toEqual({ success: false, statusCode: undefined, error: NOT_PUBLIC });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('refuses a hostname with one public and one private record', async () => {
    lookupMock.mockResolvedValue([...PUBLIC, { address: '10.0.0.8', family: 4 }]);
    expect(await sendTestWebhook(webhook('https://mixed.example.com/hook'))).toMatchObject({ success: false, error: NOT_PUBLIC });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('reports a 302 as a failure without following it', async () => {
    respond({ statusCode: 302, headers: { location: 'https://10.0.0.8/' }, body: BODY_MARKER });
    expect(await sendTestWebhook(webhook('https://hooks.example.com/hook'))).toEqual({
      success: false,
      statusCode: 302,
      error: 'HTTP 302: redirects are not followed',
    });
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it('succeeds for a public host', async () => {
    respond({ statusCode: 204, body: BODY_MARKER });
    expect(await sendTestWebhook(webhook('https://hooks.example.com/hook'))).toEqual({ success: true, statusCode: 204 });
  });

  it.each([400, 404, 500])('returns the status code and no response text for HTTP %i', async (statusCode) => {
    respond({ statusCode, body: BODY_MARKER });
    const result = await sendTestWebhook(webhook('https://hooks.example.com/hook'));
    expect(result).toEqual({ success: false, statusCode, error: `HTTP ${statusCode}` });
    expect(JSON.stringify(result)).not.toContain(BODY_MARKER);
  });
});

describe('validateWebhookUrl', () => {
  it.each([
    'https://hooks.slack.com/services/T000/B000/XXXX',
    'https://example.webhook.office.com/webhookb2/abc',
    'https://discord.com/api/webhooks/123/abc',
    'https://hooks.example.com:8443/custom',
  ])('accepts %s', (url) => {
    expect(validateWebhookUrl(url)).toEqual({ valid: true });
  });

  it.each([
    ['http://hooks.example.com/in', 'URL must use HTTPS'],
    ['https://user:pass@hooks.example.com/in', 'URL must not contain credentials'],
    ['nonsense', 'Invalid URL format'],
  ])('refuses %s', (url, error) => {
    expect(validateWebhookUrl(url)).toEqual({ valid: false, error });
  });
});
