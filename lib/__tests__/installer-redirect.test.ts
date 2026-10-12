import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('node:https', () => ({ request: requestMock }));
vi.mock('node:http', () => ({ request: requestMock }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]) }));

import { hashRemoteInstaller } from '@/lib/installer-download';

type Reply = { headers: Record<string, string>; statusCode: number; body?: Buffer };

function respond(...replies: Reply[]) {
  for (const reply of replies) {
    requestMock.mockImplementationOnce((_options, callback) => {
      const request = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void };
      request.setTimeout = () => {};
      request.end = () => queueMicrotask(() => {
        const response = Object.assign(new PassThrough(), reply);
        callback(response);
        if (!response.destroyed) response.end(reply.body);
      });
      return request;
    });
  }
}

const checksumInstaller = 'https://repo.postgrespro.com/win/64/PostgreSQL_17.7_64bit_Setup.exe';
const malformedLocation = 'https://[bad/path?token=redirect-secret';

describe('installer redirect diagnostics', () => {
  beforeEach(() => requestMock.mockReset());

  it.each([
    ['download', 'https://source.example.test/setup.msi?token=source-secret'],
    ['metadata', checksumInstaller],
  ])('identifies malformed %s redirects without exposing their URLs', async (_phase, source) => {
    respond({ statusCode: 302, headers: { location: malformedLocation } });
    const error = await hashRemoteInstaller(source).catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: 'InstallerRedirectUrlError',
      sourceHost: new URL(source).hostname,
      message: `Installer source ${new URL(source).hostname} returned an invalid redirect URL.`,
    });
    expect(JSON.stringify(error)).not.toContain('redirect-secret');
    expect(JSON.stringify(error)).not.toContain('source-secret');
    expect(error).not.toHaveProperty('cause');
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it('identifies a malformed publisher checksum redirect', async () => {
    respond(
      { statusCode: 200, headers: { 'content-length': '262144', 'accept-ranges': 'bytes', etag: '"fixture"' } },
      { statusCode: 302, headers: { location: malformedLocation } },
    );
    await expect(hashRemoteInstaller(checksumInstaller)).rejects.toMatchObject({
      name: 'InstallerRedirectUrlError',
      sourceHost: 'repo.postgrespro.com',
      message: 'Installer source repo.postgrespro.com returned an invalid redirect URL.',
    });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('continues resolving relative redirects against the source URL', async () => {
    respond(
      { statusCode: 302, headers: { location: '../current/setup.msi' } },
      { statusCode: 200, headers: { 'content-length': '7' }, body: Buffer.from('fixture') },
    );
    await expect(hashRemoteInstaller('https://source.example.test/releases/setup.msi')).resolves.toMatchObject({
      bytes: 7,
      finalUrl: 'https://source.example.test/current/setup.msi',
      verificationMethod: 'content-hash',
    });
    expect(requestMock.mock.calls[1][0].path).toBe('/current/setup.msi');
  });

  it.each([
    ['https://username:password@example.test/setup.msi', 'Installer URL must not contain credentials'],
    ['file:///setup.msi', 'Installer URL must use HTTP or HTTPS'],
    ['https://example.test:444/setup.msi', 'Installer URL uses a disallowed port'],
    ['https://127.0.0.1/setup.msi', 'Installer URL resolves to a private or reserved address'],
  ])('preserves the security rejection for %s', async (location, message) => {
    respond({ statusCode: 302, headers: { location } });
    await expect(hashRemoteInstaller('https://source.example.test/setup.msi')).rejects.toThrow(message);
    expect(requestMock).toHaveBeenCalledOnce();
  });
});
