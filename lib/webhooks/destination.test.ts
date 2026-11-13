import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock, lookupMock } = vi.hoisted(() => ({ requestMock: vi.fn(), lookupMock: vi.fn() }));
vi.mock('node:https', () => ({ request: requestMock }));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import {
  describeWebhookFailure,
  parseWebhookUrl,
  postWebhook,
  resolveWebhookDestination,
  validateWebhookDestination,
  WebhookDestinationError,
  WebhookRedirectError,
  WebhookTimeoutError,
} from './destination';

type Reply = { statusCode: number; headers?: Record<string, string>; body?: string };

/** Queue one mocked HTTPS response. Returns the request the code under test sent. */
function respond(reply: Reply) {
  const sent: { body?: string; destroyed: boolean } = { destroyed: false };
  requestMock.mockImplementationOnce((_options, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: (body?: string) => void; destroy: () => void };
    request.destroy = () => { sent.destroyed = true; };
    request.end = (body) => {
      sent.body = body;
      queueMicrotask(() => {
        const response = Object.assign(new PassThrough(), { statusCode: reply.statusCode, headers: reply.headers ?? {} });
        callback(response);
        if (!response.destroyed) response.end(reply.body);
      });
    };
    return request;
  });
  return sent;
}

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const send = (url: string) => postWebhook(url, {
  headers: { 'Content-Type': 'application/json' },
  body: '{"event":"test"}',
  timeoutMs: 1000,
});

beforeEach(() => {
  requestMock.mockReset();
  lookupMock.mockReset();
  lookupMock.mockResolvedValue(PUBLIC);
  // The guard must never fall back to an unpinned request.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('fetch must not be used for webhooks'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('WEBHOOK_ALLOW_PRIVATE_DESTINATIONS (self-hosted opt in)', () => {
  it('is off by default and for any value other than "true"', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(resolveWebhookDestination('https://receiver.lan/hook')).rejects.toMatchObject({ code: 'not_public' });

    for (const value of ['1', 'TRUE', 'yes', '']) {
      vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_DESTINATIONS', value);
      await expect(resolveWebhookDestination('https://receiver.lan/hook')).rejects.toMatchObject({ code: 'not_public' });
      await expect(resolveWebhookDestination('https://192.168.1.20/hook')).rejects.toMatchObject({ code: 'not_public' });
    }
  });

  it('lets the operator allow receivers on the local network, still pinned and HTTPS only', async () => {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_DESTINATIONS', 'true');
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    await expect(resolveWebhookDestination('https://receiver.lan/hook')).resolves.toMatchObject({ address: '10.0.0.5' });
    await expect(resolveWebhookDestination('https://192.168.1.20/hook')).resolves.toMatchObject({ address: '192.168.1.20' });
    await expect(resolveWebhookDestination('http://receiver.lan/hook')).rejects.toMatchObject({ code: 'invalid' });

    respond({ statusCode: 302, headers: { location: 'https://elsewhere.example/' } });
    await expect(send('https://receiver.lan/hook')).rejects.toBeInstanceOf(WebhookRedirectError);
    expect(requestMock.mock.calls[0][0]).toMatchObject({ hostname: '10.0.0.5', servername: 'receiver.lan' });
  });

  it('still refuses link-local addresses, where cloud metadata lives', async () => {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_DESTINATIONS', 'true');

    for (const url of ['https://169.254.169.254/latest/meta-data', 'https://[fe80::1]/hook', 'https://[::ffff:169.254.169.254]/hook']) {
      await expect(resolveWebhookDestination(url)).rejects.toMatchObject({ code: 'not_public' });
    }

    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }, { address: '169.254.169.254', family: 4 }]);
    await expect(resolveWebhookDestination('https://receiver.lan/hook')).rejects.toMatchObject({ code: 'not_public' });
  });
});

describe('parseWebhookUrl', () => {
  it.each([
    ['http://hooks.example.com/in', 'URL must use HTTPS'],
    ['ftp://hooks.example.com/in', 'URL must use HTTPS'],
    ['https://user:secret@hooks.example.com/in', 'URL must not contain credentials'],
    ['https://user@hooks.example.com/in', 'URL must not contain credentials'],
    ['not a url', 'Invalid URL format'],
    ['', 'Invalid URL format'],
  ])('refuses %s', (url, message) => {
    expect(() => parseWebhookUrl(url)).toThrow(message);
  });

  it('refuses a value that is not a string', () => {
    expect(() => parseWebhookUrl(null as unknown as string)).toThrow('Invalid URL format');
  });

  it('accepts HTTPS on any port', () => {
    expect(parseWebhookUrl('https://hooks.example.com:8443/in').port).toBe('8443');
  });
});

describe('resolveWebhookDestination', () => {
  it.each([
    ['loopback', 'https://127.0.0.1/hook'],
    ['loopback in another notation', 'https://2130706433/hook'],
    ['10.x', 'https://10.1.2.3/hook'],
    ['172.16.x', 'https://172.16.5.4/hook'],
    ['192.168.x', 'https://192.168.1.10/hook'],
    ['link-local metadata', 'https://169.254.169.254/latest/meta-data/'],
    ['carrier grade NAT', 'https://100.64.0.1/hook'],
    ['IPv6 loopback', 'https://[::1]/hook'],
    ['IPv6 unique local (fc)', 'https://[fc00::1]/hook'],
    ['IPv6 unique local (fd)', 'https://[fd00::1]/hook'],
    ['IPv6 link-local', 'https://[fe80::1]/hook'],
    ['IPv4-mapped IPv6 of a private address', 'https://[::ffff:10.0.0.1]/hook'],
    ['IPv4-mapped IPv6 of loopback', 'https://[::ffff:127.0.0.1]/hook'],
    ['IPv4-mapped IPv6 of the metadata address', 'https://[::ffff:169.254.169.254]/hook'],
  ])('refuses a literal %s address without a lookup', async (_label, url) => {
    await expect(resolveWebhookDestination(url)).rejects.toMatchObject({
      name: 'WebhookDestinationError',
      code: 'not_public',
    });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a private address', [{ address: '10.0.0.5', family: 4 }]],
    ['loopback', [{ address: '127.0.0.1', family: 4 }]],
    ['the metadata address', [{ address: '169.254.169.254', family: 4 }]],
    ['an IPv6 unique local address', [{ address: 'fd00::5', family: 6 }]],
    ['an IPv4-mapped private address', [{ address: '::ffff:192.168.0.1', family: 6 }]],
    ['one public and one private record', [...PUBLIC, { address: '192.168.1.20', family: 4 }]],
    ['one private and one public record', [{ address: '10.0.0.5', family: 4 }, ...PUBLIC]],
  ])('refuses a hostname that resolves to %s', async (_label, addresses) => {
    lookupMock.mockResolvedValue(addresses);
    await expect(resolveWebhookDestination('https://internal.example.com/hook')).rejects.toMatchObject({
      code: 'not_public',
    });
    expect(lookupMock).toHaveBeenCalledWith('internal.example.com', { all: true, verbatim: true });
  });

  it('refuses a hostname that does not resolve, with the same message as a private one', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const privateError = await resolveWebhookDestination('https://a.example.com/').catch((error) => error);
    lookupMock.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    const missingError = await resolveWebhookDestination('https://b.example.com/').catch((error) => error);
    lookupMock.mockResolvedValue([]);
    const emptyError = await resolveWebhookDestination('https://c.example.com/').catch((error) => error);

    expect(missingError).toBeInstanceOf(WebhookDestinationError);
    expect(missingError.code).toBe('unresolved');
    expect(emptyError.code).toBe('unresolved');
    expect(missingError.message).toBe(privateError.message);
    expect(missingError.message).not.toContain('ENOTFOUND');
  });

  it('returns the validated address for a public host', async () => {
    const destination = await resolveWebhookDestination('https://hooks.example.com:8443/in?x=1');
    expect(destination).toMatchObject({ address: '93.184.216.34', family: 4 });
    expect(destination.url.host).toBe('hooks.example.com:8443');
  });

  it('accepts a public literal address', async () => {
    await expect(resolveWebhookDestination('https://8.8.8.8/hook')).resolves.toMatchObject({ address: '8.8.8.8', family: 4 });
    await expect(resolveWebhookDestination('https://[2606:4700:4700::1111]/hook')).resolves.toMatchObject({
      address: '2606:4700:4700::1111',
      family: 6,
    });
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe('validateWebhookDestination', () => {
  it.each([
    'https://hooks.slack.com/services/T000/B000/XXXX',
    'https://example.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi',
    'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=xyz',
    'https://discord.com/api/webhooks/123/abc',
    'https://hooks.example.com/any/path',
  ])('accepts %s when it resolves to a public address', async (url) => {
    await expect(validateWebhookDestination(url)).resolves.toEqual({ valid: true });
  });

  it('explains a refused destination without naming the address', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const result = await validateWebhookDestination('https://internal.example.com/hook');
    expect(result).toEqual({ valid: false, error: 'Webhook URL must point to a host on the public internet' });
  });

  it('reports string level problems', async () => {
    await expect(validateWebhookDestination('http://hooks.example.com/in')).resolves.toEqual({
      valid: false,
      error: 'URL must use HTTPS',
    });
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe('postWebhook', () => {
  it('connects to the validated address and keeps the hostname for TLS and Host', async () => {
    const sent = respond({ statusCode: 200, body: 'ok' });
    await expect(send('https://hooks.example.com:8443/in?x=1')).resolves.toEqual({ status: 200, bodyExcerpt: 'ok' });

    expect(requestMock).toHaveBeenCalledOnce();
    const options = requestMock.mock.calls[0][0];
    expect(options).toMatchObject({
      protocol: 'https:',
      hostname: '93.184.216.34',
      family: 4,
      port: '8443',
      path: '/in?x=1',
      method: 'POST',
      servername: 'hooks.example.com',
    });
    expect(options.headers).toMatchObject({
      Host: 'hooks.example.com:8443',
      'Content-Type': 'application/json',
      'Content-Length': '16',
    });
    expect(sent.body).toBe('{"event":"test"}');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves again on every call so a changed DNS answer is refused', async () => {
    respond({ statusCode: 200 });
    await send('https://rebind.example.com/in');
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(send('https://rebind.example.com/in')).rejects.toMatchObject({ code: 'not_public' });
    expect(lookupMock).toHaveBeenCalledTimes(2);
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it('never sends a request to a refused destination', async () => {
    lookupMock.mockResolvedValue([...PUBLIC, { address: '192.168.1.20', family: 4 }]);
    await expect(send('https://mixed.example.com/in')).rejects.toBeInstanceOf(WebhookDestinationError);
    await expect(send('https://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(WebhookDestinationError);
    await expect(send('https://[::ffff:10.0.0.1]/in')).rejects.toBeInstanceOf(WebhookDestinationError);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([301, 302, 303, 307, 308])('treats a %i response as a failure and does not follow it', async (statusCode) => {
    respond({ statusCode, headers: { location: 'https://127.0.0.1/admin' }, body: 'redirect body' });
    const error = await send('https://hooks.example.com/in').catch((value) => value);
    expect(error).toBeInstanceOf(WebhookRedirectError);
    expect(error.message).toBe(`HTTP ${statusCode}: redirects are not followed`);
    expect(error.statusCode).toBe(statusCode);
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it('does not let a custom header replace the validated host or the framing headers', async () => {
    respond({ statusCode: 200 });
    await postWebhook('https://hooks.example.com/in', {
      headers: { host: 'internal.example.com', 'Content-Length': '1', 'Transfer-Encoding': 'chunked', 'X-Custom': 'kept' },
      body: 'payload',
      timeoutMs: 1000,
    });
    const { headers } = requestMock.mock.calls[0][0];
    expect(headers.Host).toBe('hooks.example.com');
    expect(headers['Content-Length']).toBe('7');
    expect(headers).not.toHaveProperty('host');
    expect(headers).not.toHaveProperty('Transfer-Encoding');
    expect(headers['X-Custom']).toBe('kept');
  });

  it('does not set a TLS server name for a literal address', async () => {
    respond({ statusCode: 204 });
    await send('https://8.8.8.8/in');
    const options = requestMock.mock.calls[0][0];
    expect(options.hostname).toBe('8.8.8.8');
    expect(options).not.toHaveProperty('servername');
  });

  it('keeps only a bounded excerpt of the response body', async () => {
    respond({ statusCode: 500, body: 'x'.repeat(20000) });
    const response = await send('https://hooks.example.com/in');
    expect(response.status).toBe(500);
    expect(response.bodyExcerpt).toHaveLength(4096);
  });

  it('times out when the destination never answers', async () => {
    let destroyed = false;
    requestMock.mockImplementationOnce(() => {
      const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      request.end = () => {};
      request.destroy = () => { destroyed = true; };
      return request;
    });
    await expect(postWebhook('https://hooks.example.com/in', { headers: {}, body: '{}', timeoutMs: 20 }))
      .rejects.toBeInstanceOf(WebhookTimeoutError);
    expect(destroyed).toBe(true);
  });

  it('reports a connection error', async () => {
    requestMock.mockImplementationOnce(() => {
      const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      request.destroy = () => {};
      request.end = () => queueMicrotask(() => {
        request.emit('error', Object.assign(new Error('connect ECONNREFUSED 93.184.216.34:443'), { code: 'ECONNREFUSED' }));
      });
      return request;
    });
    const error = await send('https://hooks.example.com/in').catch((value) => value);
    expect(describeWebhookFailure(error)).toEqual({ message: 'Connection failed (ECONNREFUSED)', retryable: true });
  });
});

describe('describeWebhookFailure', () => {
  it('marks refused destinations and redirects as permanent', () => {
    expect(describeWebhookFailure(new WebhookDestinationError('not_public', 'refused'))).toEqual({
      message: 'refused',
      retryable: false,
    });
    expect(describeWebhookFailure(new WebhookDestinationError('invalid', 'URL must use HTTPS')).retryable).toBe(false);
    expect(describeWebhookFailure(new WebhookRedirectError(302))).toEqual({
      message: 'HTTP 302: redirects are not followed',
      retryable: false,
      statusCode: 302,
    });
  });

  it('marks lookup failures, timeouts and connection errors as retryable', () => {
    expect(describeWebhookFailure(new WebhookDestinationError('unresolved', 'unresolved')).retryable).toBe(true);
    expect(describeWebhookFailure(new WebhookTimeoutError())).toEqual({ message: 'Request timed out', retryable: true });
    expect(describeWebhookFailure(new Error('socket hang up'))).toEqual({ message: 'Connection failed', retryable: true });
  });

  it('never repeats free text from an error', () => {
    const error = Object.assign(new Error('Hostname/IP does not match: internal detail'), { code: 'some text here' });
    expect(describeWebhookFailure(error).message).toBe('Connection failed');
  });
});
