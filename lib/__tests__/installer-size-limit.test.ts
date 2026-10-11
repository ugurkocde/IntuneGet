import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('node:https', () => ({ request: requestMock }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]) }));

import { hashRemoteInstaller, InstallerDownloadSizeLimitError } from '@/lib/installer-download';

describe('installer size refusals through the download paths', () => {
  beforeEach(() => requestMock.mockReset());

  function respond(headers: Record<string, string>, body = Buffer.alloc(0), statusCode = 200) {
    requestMock.mockImplementation((_options, callback) => {
      const request = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void };
      request.setTimeout = () => {};
      request.end = () => queueMicrotask(() => {
        const response = Object.assign(new PassThrough(), { headers, statusCode });
        callback(response);
        if (!response.destroyed) response.end(body);
      });
      return request;
    });
  }

  it('refuses a normal response from content length before hashing bytes', async () => {
    respond({ 'content-length': '101' });
    await expect(hashRemoteInstaller('https://example.test/setup.exe', { maxBytes: 100 }))
      .rejects.toMatchObject({ name: 'InstallerDownloadSizeLimitError', maxBytes: 100, observedBytes: 101 });
  });

  it('refuses streamed bytes when the server omits content length', async () => {
    respond({}, Buffer.alloc(101));
    await expect(hashRemoteInstaller('https://example.test/setup.exe', { maxBytes: 100 }))
      .rejects.toBeInstanceOf(InstallerDownloadSizeLimitError);
  });

  it('refuses the ranged metadata size without starting chunks', async () => {
    respond({ 'content-length': '101', 'accept-ranges': 'bytes' });
    await expect(hashRemoteInstaller('https://repo.postgrespro.ru/win/64/PostgreSQL_17.7_64bit_Setup.exe', { maxBytes: 100 }))
      .rejects.toMatchObject({ name: 'InstallerDownloadSizeLimitError', maxBytes: 100, observedBytes: 101 });
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it('hashes a response exactly at the limit', async () => {
    respond({ 'content-length': '100' }, Buffer.alloc(100));
    await expect(hashRemoteInstaller('https://example.test/setup.exe', { maxBytes: 100 }))
      .resolves.toMatchObject({ bytes: 100, verificationMethod: 'content-hash' });
  });
});
