import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { requestMock, lookupMock } = vi.hoisted(() => ({ requestMock: vi.fn(), lookupMock: vi.fn() }));
vi.mock('node:https', () => ({ request: requestMock }));
vi.mock('node:http', () => ({ request: requestMock }));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));
import { probeInstallerSource } from '@/lib/installer-download';
function replies(...values: Array<{ statusCode: number; headers: Record<string, string> }>) {
  const responses: PassThrough[] = [];
  for (const value of values) requestMock.mockImplementationOnce((_options, callback) => {
    const request = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), end: () => queueMicrotask(() => {
      const response = Object.assign(new PassThrough(), value); responses.push(response); callback(response);
      if (!response.destroyed) response.end(Buffer.from('payload must not be consumed'));
    }) }); return request;
  }); return responses;
}
describe('non-accepting installer source probe', () => {
  beforeEach(() => { requestMock.mockReset(); lookupMock.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); });
  it('uses the download GET redirect rules and destroys the payload without a data listener', async () => {
    const responses = replies({ statusCode: 302, headers: { location: '../new/setup.msi?token=secret#private' } }, { statusCode: 200, headers: {} });
    const result = await probeInstallerSource('https://source.test/releases/setup.msi?token=source-secret');
    expect(result.outcome).toBe('reachable'); expect(result.hops).toHaveLength(2);
    expect(requestMock.mock.calls[1][0]).toMatchObject({ method: 'GET', path: '/new/setup.msi?token=secret' });
    expect(responses[1].destroyed).toBe(true); expect(responses[1].listenerCount('data')).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/secret|private|setup\.msi/);
  });
  it('reports malformed Location shape, never its raw contents or a digest', async () => {
    replies({ statusCode: 302, headers: { location: 'https://[bad/path?token=redirect-secret' } });
    const result = await probeInstallerSource('https://source.test/setup.msi');
    expect(result).toMatchObject({ outcome: 'failed', errorCode: 'REDIRECT_URL_INVALID' });
    expect(result.hops[0]).toMatchObject({ hop: 1, status: 302, location: { form: 'absolute', hasBracket: true } });
    expect(JSON.stringify(result)).not.toMatch(/redirect-secret|bad\/path|token|sha256/); expect(requestMock).toHaveBeenCalledOnce();
  });
  it.each(['file:///private', 'https://user:secret@source.test/setup', 'https://source.test:444/setup'])('refuses a disallowed redirect %s', async location => {
    replies({ statusCode: 302, headers: { location } });
    expect(await probeInstallerSource('https://source.test/setup')).toMatchObject({ outcome: 'failed', errorCode: 'REDIRECT_DISALLOWED' });
    expect(requestMock).toHaveBeenCalledOnce();
  });
  it('refuses private targets without contacting them', async () => {
    replies({ statusCode: 302, headers: { location: 'https://127.0.0.1/secret' } });
    expect(await probeInstallerSource('https://source.test/setup')).toMatchObject({ outcome: 'failed', errorCode: 'PRIVATE_ADDRESS' });
    expect(requestMock).toHaveBeenCalledOnce();
  });
  it('keeps HTTP failure separate from acceptance and strips error messages', async () => {
    replies({ statusCode: 403, headers: {} });
    expect(await probeInstallerSource('https://source.test/setup')).toMatchObject({ outcome: 'failed', errorCode: 'HTTP_STATUS' });
  });
});

function failRequest(code: string, message = 'private error detail') {
  requestMock.mockImplementationOnce(() => {
    const request = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), end: () => queueMicrotask(() => request.emit('error', Object.assign(new Error(message), { code }))) });
    return request;
  });
}
describe('source network evidence without private values', () => {
  beforeEach(() => { requestMock.mockReset(); lookupMock.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); });
  it('records the redirected hostname before its DNS lookup fails', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockRejectedValueOnce(Object.assign(new Error('secret-path token=secret'), { code: 'ENOTFOUND' }));
    replies({ statusCode: 302, headers: { location: 'https://mirror.test/a/b?token=secret#fragment' } });
    const result = await probeInstallerSource('https://source.test/start');
    expect(result).toMatchObject({ outcome: 'failed', errorCode: 'NETWORK', networkCode: 'ENOTFOUND' });
    expect(result.hops[0].next).toEqual({ scheme: 'https', host: 'mirror.test', pathSegments: 2 });
    expect(result).not.toHaveProperty('addressFamily');
    expect(JSON.stringify(result)).not.toMatch(/secret|fragment|token|secret-path/);
    expect(requestMock).toHaveBeenCalledOnce();
  });
  it('records the failed attempt family without exposing the resolved address', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockResolvedValueOnce([{ address: '2606:4700:4700::1111', family: 6 }]);
    replies({ statusCode: 302, headers: { location: 'https://mirror.test/setup' } });
    failRequest('ENETUNREACH', 'connect ENETUNREACH 2606:4700:4700::1111:443 private-token');
    const result = await probeInstallerSource('https://source.test/start');
    expect(result).toMatchObject({ errorCode: 'NETWORK', networkCode: 'ENETUNREACH', addressFamily: 6 });
    expect(JSON.stringify(result)).not.toMatch(/2606|private-token/);
  });
  it.each([['ERR_TLS_CERT_ALTNAME_INVALID','ERR_TLS_CERT_ALTNAME_INVALID'],['HPE_INVALID_CONSTANT','HTTP_PARSE'],['ERR_SSL_WRONG_VERSION_NUMBER','TLS_OTHER'],['ERR_INVALID_URL','ERR_INVALID_URL'],['EWEIRD_SECRET','OTHER']])('returns only the safe category for %s', async (code, expected) => {
    failRequest(code, 'token=secret with private/path');
    const result = await probeInstallerSource('https://source.test/start');
    expect(result).toMatchObject({ errorCode: 'NETWORK', networkCode: expected, addressFamily: 4 });
    expect(JSON.stringify(result)).not.toMatch(/token|secret|private\/path/);
  });
  it('redacts IP literal redirect targets even when they are publicly routable', async () => {
    replies({ statusCode: 302, headers: { location: 'https://8.8.8.8/a' } }, { statusCode: 200, headers: {} });
    const result = await probeInstallerSource('https://source.test/start');
    expect(result.hops[0].next).toEqual({ scheme: 'https', host: '[address]', pathSegments: 1 });
    expect(JSON.stringify(result)).not.toContain('8.8.8.8');
  });
});

const sourceModulePath = new URL('../installer-download.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
function runtimeError(stack: string) {
  return Object.assign(new Error('private-url?token=secret'), { code: 'ERR_INVALID_URL', stack });
}
describe('source request origin without stack disclosure', () => {
  beforeEach(() => { requestMock.mockReset(); lookupMock.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); });
  it.each([
    ['node_internal', `Error\n    at new URL (node:internal/url:1:2)\n    at request (${sourceModulePath}:800:1)`],
    ['other', `Error\n    at new URL (node:internal/url:1:2)\n    at wrapper (/private/runtime/wrapper.js:1:2)\n    at request (${sourceModulePath}:800:1)`],
    ['app', `Error\n    at request (${sourceModulePath}:800:1)`],
    ['other', 'Error\n    at new URL (node:internal/url:1:2)'],
    ['other', ''],
  ])('attributes synchronous request failure to %s conservatively', async (networkOrigin, stack) => {
    requestMock.mockImplementationOnce(() => { throw runtimeError(stack); });
    const result = await probeInstallerSource('https://source.test/start');
    expect(result).toMatchObject({ errorCode: 'NETWORK', networkCode: 'ERR_INVALID_URL', networkPhase: 'request_throw', networkOrigin, runtimeNode: process.versions.node });
    expect(JSON.stringify(result)).not.toMatch(/private|wrapper|secret|token|internal\/url|installer-download/);
  });
  it('does not attribute an asynchronous request error to Node from its stack', async () => {
    requestMock.mockImplementationOnce(() => {
      const request = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), end: () => queueMicrotask(() => request.emit('error', runtimeError(`Error\n at socket (node:internal/tls:1:2)`))) });
      return request;
    });
    expect(await probeInstallerSource('https://source.test/start')).toMatchObject({ networkPhase: 'request_error', networkOrigin: 'other', runtimeNode: process.versions.node });
  });
  it('captures a synchronous response callback exception without changing the hash callback', async () => {
    const destroy = vi.fn();
    requestMock.mockImplementationOnce((_options, callback) => {
      const request = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), end: () => queueMicrotask(() => callback({ destroy, get statusCode() { throw runtimeError(`Error\n at wrapper (/private/runtime.js:1:2)\n at app (${sourceModulePath}:800:1)`); } })) });
      return request;
    });
    expect(await probeInstallerSource('https://source.test/start')).toMatchObject({ networkPhase: 'response_callback', networkOrigin: 'other' });
    expect(destroy).toHaveBeenCalledOnce();
  });
  it('does not inherit the first hop phase or origin when redirected DNS fails', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockRejectedValueOnce(Object.assign(new Error('private DNS'), { code: 'ENOTFOUND' }));
    replies({ statusCode: 302, headers: { location: 'https://mirror.test/setup' } });
    const result = await probeInstallerSource('https://source.test/start');
    expect(result).toMatchObject({ networkCode: 'ENOTFOUND', runtimeNode: process.versions.node });
    expect(result).not.toHaveProperty('networkPhase'); expect(result).not.toHaveProperty('networkOrigin'); expect(result).not.toHaveProperty('addressFamily');
  });
  it('locates its module in a bundled chunk rather than relying on a source filename', async () => {
    const OriginalError = Error;
    vi.stubGlobal('Error', class extends OriginalError { constructor(message?: string) { super(message); this.stack = 'Error\n at module (/var/task/.next/server/chunks/abc123.js:1:2)'; } });
    let bundledProbe: typeof probeInstallerSource;
    try { vi.resetModules(); bundledProbe = (await import('@/lib/installer-download')).probeInstallerSource; }
    finally { vi.unstubAllGlobals(); }
    requestMock.mockImplementationOnce(() => { throw runtimeError('Error\n at new URL (node:internal/url:1:2)\n at app (/var/task/.next/server/chunks/abc123.js:700:1)'); });
    expect(await bundledProbe!('https://source.test/start')).toMatchObject({ networkPhase: 'request_throw', networkOrigin: 'node_internal' });
  });
});
