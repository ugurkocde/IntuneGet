import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PackagerConfig } from '../src/config';
import { GraphClient } from '../src/graph-client';
import { IntuneUploader } from '../src/intune-uploader';
import type { PackagingJob } from '../src/job-poller';
import type { ProxyRouting } from '../src/proxy-routing';

type MockFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
};

function makeResponse(status: number, statusText: string, body = ''): MockFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => body,
  };
}

function makeConfig(fetchMock: ReturnType<typeof vi.fn>): PackagerConfig {
  return {
    proxy: { fetch: fetchMock, agentFor: () => undefined } as unknown as ProxyRouting,
    packagerId: 'test-packager',
    mode: 'api',
    supabase: { url: '', serviceRoleKey: '' },
    api: { url: 'https://example.com', key: 'test-key' },
    azure: {
      clientId: '00000000-0000-0000-0000-000000000000',
      clientSecret: 'test-secret',
      useManagedIdentity: false,
    },
    polling: { interval: 5000, staleJobTimeout: 300000 },
    paths: { work: 'work', tools: 'tools' },
  };
}

function makeJob(): PackagingJob {
  return {
    id: 'job-2142',
    user_id: 'user-1',
    user_email: 'qa@example.com',
    tenant_id: 'tenant-1',
    winget_id: 'Contoso.LargeApp',
    version: '2.0.0',
    display_name: 'Contoso Large App',
    publisher: 'Contoso',
    architecture: 'x64',
    installer_type: 'exe',
    installer_url: 'https://example.com/large.exe',
    installer_sha256: 'A'.repeat(64),
    install_command: '',
    uninstall_command: '',
    install_scope: 'machine',
    detection_rules: [],
    package_config: { forceCreate: true },
    status: 'queued',
    progress_percent: 0,
    created_at: '2026-11-27T14:00:00.000Z',
  };
}

const tempFiles: string[] = [];

function createTempFile(sizeBytes: number): string {
  const filePath = path.join(os.tmpdir(), `intuneget-sas-test-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
  const fd = fs.openSync(filePath, 'w');
  try {
    if (sizeBytes > 0) {
      fs.writeSync(fd, Buffer.alloc(1, 0x41), 0, 1, sizeBytes - 1);
    }
  } finally {
    fs.closeSync(fd);
  }
  tempFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempFiles.length > 0) {
    const file = tempFiles.pop()!;
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore cleanup error
    }
  }
});

describe('IntuneUploader SAS token renewal and block upload resilience (#2142)', () => {
  it('renews an expired SAS URI via renewUpload when a block upload returns 403 and finishes uploading without restarting', async () => {
    const initialUri = 'https://blob.example.test/container/app.bin?sv=2024&sig=INITIAL_SECRET_SIG';
    const renewedUri = 'https://blob.example.test/container/app.bin?sv=2024&sig=RENEWED_SECRET_SIG';
    const filePath = createTempFile(7 * 1024 * 1024); // 2 x 6 MiB chunks

    const uploadedUrls: string[] = [];
    let block1AuthFailures = 0;
    const block0Id = encodeURIComponent(Buffer.from('000000').toString('base64'));
    const block1Id = encodeURIComponent(Buffer.from('000001').toString('base64'));
    let markBlock0Staged!: () => void;
    const block0Staged = new Promise<void>((resolve) => {
      markBlock0Staged = resolve;
    });

    const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: unknown }) => {
      uploadedUrls.push(url);
      if (url.includes('comp=block&')) {
        if (url.includes(`blockid=${block0Id}`) && url.startsWith(initialUri)) {
          markBlock0Staged();
          return makeResponse(201, 'Created');
        }
        if (url.includes(`blockid=${block1Id}`) && url.startsWith(initialUri) && block1AuthFailures === 0) {
          // Ensure block 0 has already been accepted on initialUri before block 1 triggers renewal
          await block0Staged;
          block1AuthFailures++;
          return makeResponse(
            403,
            'Server failed to authenticate the request. Make sure the value of Authorization header is formed correctly including the signature.',
            '<Error><Code>AuthenticationFailed</Code><Message>Signed expiry time has passed.</Message></Error>'
          );
        }
        return makeResponse(201, 'Created');
      }
      if (url.includes('comp=blocklist')) {
        expect(url.startsWith(renewedUri)).toBe(true);
        const xml = String(init?.body ?? '');
        const rawBlock0Id = Buffer.from('000000').toString('base64');
        const rawBlock1Id = Buffer.from('000001').toString('base64');
        expect(xml).toContain(`<Latest>${rawBlock0Id}</Latest><Latest>${rawBlock1Id}</Latest>`);
        return makeResponse(201, 'Created');
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const postSpy = vi.spyOn(GraphClient.prototype, 'post').mockImplementation(async (endpoint: string) => {
      if (endpoint === '/deviceAppManagement/mobileApps') return { id: 'app-2142' };
      if (endpoint.endsWith('/contentVersions')) return { id: 'cv-1' };
      if (endpoint.endsWith('/files')) return { id: 'file-1' };
      if (endpoint.endsWith('/files/file-1/renewUpload')) return {};
      if (endpoint.endsWith('/files/file-1/commit')) return {};
      return {};
    });

    let fileGetCount = 0;
    let renewed = false;
    vi.spyOn(GraphClient.prototype, 'get').mockImplementation(async (endpoint: string) => {
      if (endpoint.endsWith('/files/file-1')) {
        fileGetCount++;
        if (fileGetCount === 1) {
          return {
            azureStorageUri: initialUri,
            azureStorageUriExpirationDateTime: new Date(Date.now() + 10 * 60_000).toISOString(),
            uploadState: 'azureStorageUriRequestSuccess',
          };
        }
        if (postSpy.mock.calls.some(([p]) => String(p).endsWith('/renewUpload')) && !renewed) {
          renewed = true;
          return {
            azureStorageUri: renewedUri,
            azureStorageUriExpirationDateTime: new Date(Date.now() + 15 * 60_000).toISOString(),
            uploadState: 'azureStorageUriRenewalSuccess',
          };
        }
        return { uploadState: 'commitFileSuccess' };
      }
      return {};
    });

    vi.spyOn(GraphClient.prototype, 'patch').mockResolvedValue({});

    const uploader = new IntuneUploader(makeConfig(fetchMock));
    vi.spyOn(uploader as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue();

    const result = await uploader.uploadToIntune(
      makeJob(),
      'Invoke-AppDeployToolkit.intunewin',
      filePath,
      {
        encryptionKey: 'key',
        macKey: 'macKey',
        initializationVector: 'iv',
        mac: 'mac',
        profileIdentifier: 'ProfileVersion1',
        fileDigest: 'digest',
        fileDigestAlgorithm: 'SHA256',
      },
      { unencryptedSize: 7 * 1024 * 1024, encryptedSize: 7 * 1024 * 1024 }
    );

    expect(result.id).toBe('app-2142');
    expect(postSpy).toHaveBeenCalledWith(
      '/deviceAppManagement/mobileApps/app-2142/microsoft.graph.win32LobApp/contentVersions/cv-1/files/file-1/renewUpload'
    );
    // Block 0 must have been staged once on the original SAS and never re-uploaded on the renewed SAS
    expect(uploadedUrls.filter((u) => u.includes(`blockid=${block0Id}`) && u.startsWith(initialUri))).toHaveLength(1);
    expect(uploadedUrls.filter((u) => u.includes(`blockid=${block0Id}`) && u.startsWith(renewedUri))).toHaveLength(0);
    expect(uploadedUrls.filter((u) => u.includes(`blockid=${block1Id}`) && u.startsWith(renewedUri))).toHaveLength(1);
  });

  it('proactively renews the SAS URI before expiration using azureStorageUriExpirationDateTime', async () => {
    const filePath = createTempFile(48); // 3 x 16-byte chunks
    let nowMs = 1_700_000_000_000;
    const initialUri = 'https://blob.example.test/c/b?sig=OLD_SIG';
    const renewedUri = 'https://blob.example.test/c/b?sig=NEW_SIG';
    const seenUris: string[] = [];

    const fetchMock = vi.fn(async (url: string) => {
      seenUris.push(url);
      // Advance clock once after chunk 0 past the proactive renewal threshold (within 2 min of expiry)
      if (seenUris.length === 1) {
        nowMs += 9 * 60_000;
      }
      return makeResponse(201, 'Created');
    });

    const renewFn = vi.fn(async () => ({
      azureStorageUri: renewedUri,
      expiresAtMs: nowMs + 15 * 60_000,
    }));

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; now?: () => number; retryBaseDelayMs?: number }
      ) => Promise<void>;
    };

    await uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: initialUri, expiresAtMs: nowMs + 10 * 60_000 },
      renewFn,
      undefined,
      { chunkSize: 16, concurrency: 1, now: () => nowMs, retryBaseDelayMs: 0 }
    );

    expect(renewFn).toHaveBeenCalledTimes(1);
    expect(seenUris[0].startsWith(initialUri)).toBe(true);
    expect(seenUris[1].startsWith(renewedUri)).toBe(true);
    expect(seenUris[2].startsWith(renewedUri)).toBe(true);
    expect(seenUris[3].startsWith(renewedUri)).toBe(true);
  });

  it('proactively renews after fallback lifetime when azureStorageUriExpirationDateTime is absent', async () => {
    const filePath = createTempFile(32); // 2 x 16-byte chunks
    let nowMs = 1_700_000_000_000;
    const initialUri = 'https://blob.example.test/c/b?sig=OLD_SIG';
    const renewedUri = 'https://blob.example.test/c/b?sig=NEW_SIG';

    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        nowMs += 8 * 60_000; // exceeds 7-minute fallback lifetime once after chunk 0
      }
      return makeResponse(201, 'Created');
    });
    const renewFn = vi.fn(async () => ({ azureStorageUri: renewedUri }));

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; now?: () => number; retryBaseDelayMs?: number }
      ) => Promise<void>;
    };

    await uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: initialUri },
      renewFn,
      undefined,
      { chunkSize: 16, concurrency: 1, now: () => nowMs, retryBaseDelayMs: 0 }
    );

    expect(renewFn).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1][0]).toContain('sig=NEW_SIG');
  });

  it('deduplicates concurrent 403 SAS renewals into a single renewUpload call and preserves block order', async () => {
    const filePath = createTempFile(64); // 4 x 16-byte chunks
    const initialUri = 'https://blob.example.test/c/b?sig=EXPIRED_SIG';
    const renewedUri = 'https://blob.example.test/c/b?sig=FRESH_SIG';
    let commitXml = '';
    const progresses: number[] = [];

    // Barrier requiring all 4 concurrent workers to arrive on initialUri before any 403 returns
    let originalArrivals = 0;
    let releaseBarrier!: () => void;
    const allFourArrived = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    let delivered403s = 0;
    let releaseRenewal!: () => void;
    const all403Delivered = new Promise<void>((resolve) => {
      releaseRenewal = resolve;
    });

    const fetchMock = vi.fn(async (url: string, init?: { body?: unknown }) => {
      if (url.includes('comp=block&')) {
        if (url.startsWith(initialUri)) {
          originalArrivals++;
          if (originalArrivals === 4) {
            releaseBarrier();
          }
          await allFourArrived;
          delivered403s++;
          if (delivered403s === 4) {
            // Allow microtasks so all 4 workers enter ensureFreshSession while renewal is pending
            queueMicrotask(() => releaseRenewal());
          }
          return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
        }
        return makeResponse(201, 'Created');
      }
      if (url.includes('comp=blocklist')) {
        commitXml = String(init?.body ?? '');
        return makeResponse(201, 'Created');
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const renewFn = vi.fn(async () => {
      await all403Delivered;
      return { azureStorageUri: renewedUri, expiresAtMs: Date.now() + 15 * 60_000 };
    });

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; now?: () => number; retryBaseDelayMs?: number }
      ) => Promise<void>;
    };

    await uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: initialUri, expiresAtMs: Date.now() + 10 * 60_000 },
      renewFn,
      async (p) => { progresses.push(p); },
      { chunkSize: 16, concurrency: 4, retryBaseDelayMs: 0 }
    );

    expect(originalArrivals).toBe(4);
    expect(renewFn).toHaveBeenCalledTimes(1);
    const expectedOrder = [0, 1, 2, 3]
      .map((i) => `<Latest>${Buffer.from(String(i).padStart(6, '0')).toString('base64')}</Latest>`)
      .join('');
    expect(commitXml).toBe(`<?xml version="1.0" encoding="utf-8"?><BlockList>${expectedOrder}</BlockList>`);
    // Progress must be strictly non-decreasing and end at 100
    for (let i = 1; i < progresses.length; i++) {
      expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
    }
    expect(progresses[progresses.length - 1]).toBe(100);
  });

  it('renews the SAS URI when blocklist commit returns 403', async () => {
    const filePath = createTempFile(16);
    const initialUri = 'https://blob.example.test/c/b?sig=OLD_COMMIT_SIG';
    const renewedUri = 'https://blob.example.test/c/b?sig=NEW_COMMIT_SIG';

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('comp=block&')) return makeResponse(201, 'Created');
      if (url.includes('comp=blocklist')) {
        if (url.startsWith(initialUri)) {
          return makeResponse(403, 'Server failed to authenticate the request', 'AuthenticationFailed');
        }
        return makeResponse(201, 'Created');
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const renewFn = vi.fn(async () => ({
      azureStorageUri: renewedUri,
      expiresAtMs: Date.now() + 15 * 60_000,
    }));

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; now?: () => number; retryBaseDelayMs?: number }
      ) => Promise<void>;
    };

    await uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: initialUri, expiresAtMs: Date.now() + 10 * 60_000 },
      renewFn,
      undefined,
      { chunkSize: 16, concurrency: 1, retryBaseDelayMs: 0 }
    );

    expect(renewFn).toHaveBeenCalledTimes(1);
    const commitCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('comp=blocklist'));
    expect(commitCalls).toHaveLength(2);
    expect(commitCalls[1][0]).toContain('sig=NEW_COMMIT_SIG');
  });

  it('retries transient 503 block failures without calling renewUpload and never leaks SAS tokens in errors', async () => {
    const filePath = createTempFile(16);
    const secretUri = 'https://blob.example.test/c/b?sig=SUPER_SECRET_TOKEN_VALUE';
    let attempts = 0;

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('comp=block&')) {
        attempts++;
        if (attempts < 3) {
          return makeResponse(503, 'Service Unavailable');
        }
        return makeResponse(201, 'Created');
      }
      return makeResponse(201, 'Created');
    });
    const renewFn = vi.fn();

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; now?: () => number; retryBaseDelayMs?: number }
      ) => Promise<void>;
    };

    await uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: secretUri, expiresAtMs: Date.now() + 10 * 60_000 },
      renewFn,
      undefined,
      { chunkSize: 16, concurrency: 1, retryBaseDelayMs: 0 }
    );

    expect(attempts).toBe(3);
    expect(renewFn).not.toHaveBeenCalled();

    // Verify permanent failure error message redacts the SAS token even when the URL appears in statusText
    const failingFetch = vi.fn(async (url: string) =>
      makeResponse(400, `InvalidBlockId for ${url}`)
    );
    const failingUploader = new IntuneUploader(makeConfig(failingFetch)) as unknown as typeof uploader;
    await expect(
      failingUploader.uploadFileChunks(
        filePath,
        { azureStorageUri: secretUri, expiresAtMs: Date.now() + 10 * 60_000 },
        renewFn,
        undefined,
        { chunkSize: 16, concurrency: 1, retryBaseDelayMs: 0 }
      )
    ).rejects.toThrow(/Failed to upload block 0.*https:\/\/blob\.example\.test\/c\/b\?\[redacted\]/);
    try {
      await failingUploader.uploadFileChunks(
        filePath,
        { azureStorageUri: secretUri, expiresAtMs: Date.now() + 10 * 60_000 },
        renewFn,
        undefined,
        { chunkSize: 16, concurrency: 1, retryBaseDelayMs: 0 }
      );
    } catch (err) {
      expect(String(err)).toContain('https://blob.example.test/c/b?[redacted]');
      expect(String(err)).not.toContain('SUPER_SECRET_TOKEN_VALUE');
    }
  });

  it('renewAzureStorageUri ignores stale unchanged requestSuccess poll results and waits for renewalSuccess', async () => {
    const oldUri = 'https://blob.example.test/c/b?sig=OLD_SIG';
    const newUri = 'https://blob.example.test/c/b?sig=NEW_SIG';
    const oldExpiry = '2026-11-27T14:15:00.000Z';
    const newExpiry = '2026-11-27T14:30:00.000Z';

    const graph = {
      post: vi.fn().mockResolvedValue({}),
      get: vi
        .fn()
        .mockResolvedValueOnce({
          azureStorageUri: oldUri,
          azureStorageUriExpirationDateTime: oldExpiry,
          uploadState: 'azureStorageUriRequestSuccess',
        })
        .mockResolvedValueOnce({
          azureStorageUri: oldUri,
          azureStorageUriExpirationDateTime: oldExpiry,
          uploadState: 'azureStorageUriRenewalPending',
        })
        .mockResolvedValueOnce({
          azureStorageUri: newUri,
          azureStorageUriExpirationDateTime: newExpiry,
          uploadState: 'azureStorageUriRenewalSuccess',
        }),
    };

    const uploader = new IntuneUploader(makeConfig(vi.fn())) as unknown as {
      sleep: (ms: number) => Promise<void>;
      renewAzureStorageUri: (
        graphClient: typeof graph,
        appId: string,
        contentVersionId: string,
        contentFileId: string,
        previousSession: { azureStorageUri: string; expiresAtMs?: number }
      ) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>;
    };
    vi.spyOn(uploader, 'sleep').mockResolvedValue();

    const renewed = await uploader.renewAzureStorageUri(graph, 'app-1', 'cv-1', 'file-1', {
      azureStorageUri: oldUri,
      expiresAtMs: Date.parse(oldExpiry),
    });

    expect(graph.post).toHaveBeenCalledWith(
      '/deviceAppManagement/mobileApps/app-1/microsoft.graph.win32LobApp/contentVersions/cv-1/files/file-1/renewUpload'
    );
    expect(graph.get).toHaveBeenCalledTimes(3);
    expect(renewed).toEqual({
      azureStorageUri: newUri,
      expiresAtMs: Date.parse(newExpiry),
    });
  });

  it('renewAzureStorageUri throws on azureStorageUriRenewalFailed', async () => {
    const graph = {
      post: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({
        uploadState: 'azureStorageUriRenewalFailed',
      }),
    };

    const uploader = new IntuneUploader(makeConfig(vi.fn())) as unknown as {
      sleep: (ms: number) => Promise<void>;
      renewAzureStorageUri: (
        graphClient: typeof graph,
        appId: string,
        contentVersionId: string,
        contentFileId: string,
        previousSession: { azureStorageUri: string; expiresAtMs?: number }
      ) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>;
    };
    vi.spyOn(uploader, 'sleep').mockResolvedValue();

    await expect(
      uploader.renewAzureStorageUri(graph, 'app-1', 'cv-1', 'file-1', {
        azureStorageUri: 'https://blob.example.test/c/b?sig=OLD_SIG',
      })
    ).rejects.toThrow(/Azure Storage URI renewal failed/i);
  });

  it('renewAzureStorageUri ignores stale unchanged azureStorageUriRenewalSuccess on second renewal', async () => {
    const prevUri = 'https://blob.example.test/c/b?sig=RENEWAL_1_SIG';
    const nextUri = 'https://blob.example.test/c/b?sig=RENEWAL_2_SIG';
    const prevExpiry = '2026-11-27T14:30:00.000Z';
    const nextExpiry = '2026-11-27T14:45:00.000Z';

    const graph = {
      post: vi.fn().mockResolvedValue({}),
      get: vi
        .fn()
        .mockResolvedValueOnce({
          azureStorageUri: prevUri,
          azureStorageUriExpirationDateTime: prevExpiry,
          uploadState: 'azureStorageUriRenewalSuccess',
        })
        .mockResolvedValueOnce({
          azureStorageUri: prevUri,
          azureStorageUriExpirationDateTime: prevExpiry,
          uploadState: 'azureStorageUriRenewalPending',
        })
        .mockResolvedValueOnce({
          azureStorageUri: nextUri,
          azureStorageUriExpirationDateTime: nextExpiry,
          uploadState: 'azureStorageUriRenewalSuccess',
        }),
    };

    const uploader = new IntuneUploader(makeConfig(vi.fn())) as unknown as {
      sleep: (ms: number) => Promise<void>;
      renewAzureStorageUri: (
        graphClient: typeof graph,
        appId: string,
        contentVersionId: string,
        contentFileId: string,
        previousSession: { azureStorageUri: string; expiresAtMs?: number }
      ) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>;
    };
    vi.spyOn(uploader, 'sleep').mockResolvedValue();

    const renewed = await uploader.renewAzureStorageUri(graph, 'app-1', 'cv-1', 'file-1', {
      azureStorageUri: prevUri,
      expiresAtMs: Date.parse(prevExpiry),
    });

    expect(graph.get).toHaveBeenCalledTimes(3);
    expect(renewed).toEqual({
      azureStorageUri: nextUri,
      expiresAtMs: Date.parse(nextExpiry),
    });
  });

  it('redacts SAS query parameters from thrown network FetchError messages after retries exhaust', async () => {
    const filePath = createTempFile(16);
    const secretUri = 'https://blob.example.test/c/b?sv=2024&sig=NETWORK_SECRET_TOKEN';
    const networkFetch = vi.fn(async (url: string) => {
      throw new Error(`request to ${url} failed, reason: socket hang up`);
    });

    const uploader = new IntuneUploader(makeConfig(networkFetch)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; retryBaseDelayMs?: number; maxRetriesPerOperation?: number }
      ) => Promise<void>;
    };

    let caught: unknown;
    try {
      await uploader.uploadFileChunks(
        filePath,
        { azureStorageUri: secretUri, expiresAtMs: Date.now() + 10 * 60_000 },
        vi.fn(),
        undefined,
        { chunkSize: 16, concurrency: 1, retryBaseDelayMs: 0, maxRetriesPerOperation: 1 }
      );
    } catch (err) {
      caught = err;
    }

    expect(networkFetch).toHaveBeenCalledTimes(2);
    expect(String(caught)).toContain('Failed to upload block 0');
    expect(String(caught)).toContain('https://blob.example.test/c/b?[redacted]');
    expect(String(caught)).not.toContain('NETWORK_SECRET_TOKEN');
  });

  it('retries transient Graph GET failures during renewAzureStorageUri without repeating renewUpload POST', async () => {
    const oldUri = 'https://blob.example.test/c/b?sig=OLD_SIG';
    const newUri = 'https://blob.example.test/c/b?sig=NEW_SIG';
    const newExpiry = '2026-11-27T15:30:00.000Z';

    const graph = {
      post: vi.fn().mockResolvedValue({}),
      get: vi
        .fn()
        .mockRejectedValueOnce(new Error('Graph API GET failed: 503 - Service Unavailable'))
        .mockRejectedValueOnce(new Error('Graph API GET failed: 429 - Too Many Requests'))
        .mockResolvedValueOnce({
          azureStorageUri: newUri,
          azureStorageUriExpirationDateTime: newExpiry,
          uploadState: 'azureStorageUriRenewalSuccess',
        }),
    };

    const uploader = new IntuneUploader(makeConfig(vi.fn())) as unknown as {
      sleep: (ms: number) => Promise<void>;
      renewAzureStorageUri: (
        graphClient: typeof graph,
        appId: string,
        contentVersionId: string,
        contentFileId: string,
        previousSession: { azureStorageUri: string; expiresAtMs?: number }
      ) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>;
    };
    vi.spyOn(uploader, 'sleep').mockResolvedValue();

    const renewed = await uploader.renewAzureStorageUri(graph, 'app-1', 'cv-1', 'file-1', {
      azureStorageUri: oldUri,
    });

    expect(graph.post).toHaveBeenCalledTimes(1);
    expect(graph.get).toHaveBeenCalledTimes(3);
    expect(renewed).toEqual({
      azureStorageUri: newUri,
      expiresAtMs: Date.parse(newExpiry),
    });
  });

  it('treats a same-URI renewal with advanced expiry as a new session generation so late 403s do not trigger duplicate renewals', async () => {
    const filePath = createTempFile(32); // 2 x 16-byte chunks
    const sharedUri = 'https://blob.example.test/c/b?sig=SAME_URI';
    let arrivals = 0;
    let releaseBoth!: () => void;
    const bothArrived = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    let renewedOnce = false;

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('comp=block&')) {
        if (!renewedOnce) {
          arrivals++;
          if (arrivals === 2) {
            releaseBoth();
          }
          await bothArrived;
          return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
        }
        return makeResponse(201, 'Created');
      }
      return makeResponse(201, 'Created');
    });

    const renewFn = vi.fn(async () => {
      renewedOnce = true;
      return { azureStorageUri: sharedUri, expiresAtMs: Date.now() + 20 * 60_000 };
    });

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; retryBaseDelayMs?: number; maxRenewals?: number }
      ) => Promise<void>;
    };

    await uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: sharedUri, expiresAtMs: Date.now() + 10 * 60_000 },
      renewFn,
      undefined,
      { chunkSize: 16, concurrency: 2, retryBaseDelayMs: 0, maxRenewals: 1 }
    );

    expect(arrivals).toBe(2);
    expect(renewFn).toHaveBeenCalledTimes(1);
  });

  it('retries HTTP 503 without waiting on response.text()', async () => {
    const filePath = createTempFile(16);
    const uri = 'https://blob.example.test/c/b?sig=VALID';
    let attempts = 0;
    const textSpy = vi.fn(() => new Promise<string>(() => {})); // never resolves if awaited

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('comp=block&') && attempts === 0) {
        attempts++;
        return {
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          text: textSpy,
        };
      }
      return makeResponse(201, 'Created');
    });

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; retryBaseDelayMs?: number }
      ) => Promise<void>;
    };

    await uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: uri, expiresAtMs: Date.now() + 10 * 60_000 },
      vi.fn(),
      undefined,
      { chunkSize: 16, concurrency: 1, retryBaseDelayMs: 0 }
    );

    expect(attempts).toBe(1);
    expect(textSpy).not.toHaveBeenCalled();
  });

  it('does not spend authRenewalAttempt budget on 401/403 responses from superseded SAS sessions', async () => {
    const filePath = createTempFile(48); // 3 x 16-byte chunks
    const uris = [
      'https://blob.example.test/c/b?sig=GEN0',
      'https://blob.example.test/c/b?sig=GEN1',
      'https://blob.example.test/c/b?sig=GEN2',
      'https://blob.example.test/c/b?sig=GEN3',
    ];
    let renewIdx = 0;

    let releaseBlock1Gen0!: () => void;
    const block1Gen0CanFail = new Promise<void>((r) => { releaseBlock1Gen0 = r; });
    let block1Gen0Started!: () => void;
    const block1Gen0Arrived = new Promise<void>((r) => { block1Gen0Started = r; });

    let releaseBlock1Gen1!: () => void;
    const block1Gen1CanFail = new Promise<void>((r) => { releaseBlock1Gen1 = r; });
    let block1Gen1Started!: () => void;
    const block1Gen1Arrived = new Promise<void>((r) => { block1Gen1Started = r; });

    const blockId0 = encodeURIComponent(Buffer.from('000000').toString('base64'));
    const blockId1 = encodeURIComponent(Buffer.from('000001').toString('base64'));
    const blockId2 = encodeURIComponent(Buffer.from('000002').toString('base64'));

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(`blockid=${blockId0}`)) {
        if (url.includes('sig=GEN0')) {
          await block1Gen0Arrived;
          return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
        }
        if (url.includes('sig=GEN1')) {
          releaseBlock1Gen0();
          return makeResponse(201, 'Created');
        }
      }
      if (url.includes(`blockid=${blockId2}`)) {
        if (url.includes('sig=GEN1')) {
          await block1Gen1Arrived;
          return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
        }
        if (url.includes('sig=GEN2')) {
          releaseBlock1Gen1();
          return makeResponse(201, 'Created');
        }
      }
      if (url.includes(`blockid=${blockId1}`)) {
        if (url.includes('sig=GEN0')) {
          block1Gen0Started();
          await block1Gen0CanFail;
          return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
        }
        if (url.includes('sig=GEN1')) {
          block1Gen1Started();
          await block1Gen1CanFail;
          return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
        }
        if (url.includes('sig=GEN2')) {
          return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
        }
        if (url.includes('sig=GEN3')) {
          return makeResponse(201, 'Created');
        }
      }
      return makeResponse(201, 'Created');
    });

    const renewFn = vi.fn(async () => {
      renewIdx++;
      return { azureStorageUri: uris[renewIdx], expiresAtMs: Date.now() + 20 * 60_000 };
    });

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; retryBaseDelayMs?: number; maxRenewals?: number }
      ) => Promise<void>;
    };

    await uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: uris[0], expiresAtMs: Date.now() + 10 * 60_000 },
      renewFn,
      undefined,
      { chunkSize: 16, concurrency: 2, retryBaseDelayMs: 0, maxRenewals: 4 }
    );

    expect(renewFn).toHaveBeenCalledTimes(3);
  });

  it('does not spend authRenewalAttempt budget on body-classified SAS auth failures from superseded sessions', async () => {
    const filePath = createTempFile(48); // 3 x 16-byte chunks
    const uris = [
      'https://blob.example.test/c/b?sig=BGEN0',
      'https://blob.example.test/c/b?sig=BGEN1',
      'https://blob.example.test/c/b?sig=BGEN2',
      'https://blob.example.test/c/b?sig=BGEN3',
    ];
    let renewIdx = 0;

    let releaseBlock1Gen0!: () => void;
    const block1Gen0CanFail = new Promise<void>((r) => { releaseBlock1Gen0 = r; });
    let block1Gen0Started!: () => void;
    const block1Gen0Arrived = new Promise<void>((r) => { block1Gen0Started = r; });

    let releaseBlock1Gen1!: () => void;
    const block1Gen1CanFail = new Promise<void>((r) => { releaseBlock1Gen1 = r; });
    let block1Gen1Started!: () => void;
    const block1Gen1Arrived = new Promise<void>((r) => { block1Gen1Started = r; });

    const blockId0 = encodeURIComponent(Buffer.from('000000').toString('base64'));
    const blockId1 = encodeURIComponent(Buffer.from('000001').toString('base64'));
    const blockId2 = encodeURIComponent(Buffer.from('000002').toString('base64'));

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(`blockid=${blockId0}`)) {
        if (url.includes('sig=BGEN0')) {
          await block1Gen0Arrived;
          return makeResponse(400, 'Bad Request', '<Error><Code>AuthenticationFailed</Code></Error>');
        }
        if (url.includes('sig=BGEN1')) {
          releaseBlock1Gen0();
          return makeResponse(201, 'Created');
        }
      }
      if (url.includes(`blockid=${blockId2}`)) {
        if (url.includes('sig=BGEN1')) {
          await block1Gen1Arrived;
          return makeResponse(400, 'Bad Request', '<Error><Code>AuthenticationFailed</Code></Error>');
        }
        if (url.includes('sig=BGEN2')) {
          releaseBlock1Gen1();
          return makeResponse(201, 'Created');
        }
      }
      if (url.includes(`blockid=${blockId1}`)) {
        if (url.includes('sig=BGEN0')) {
          block1Gen0Started();
          await block1Gen0CanFail;
          return makeResponse(400, 'Bad Request', '<Error><Code>AuthenticationFailed</Code></Error>');
        }
        if (url.includes('sig=BGEN1')) {
          block1Gen1Started();
          await block1Gen1CanFail;
          return makeResponse(400, 'Bad Request', '<Error><Code>AuthenticationFailed</Code></Error>');
        }
        if (url.includes('sig=BGEN2')) {
          return makeResponse(400, 'Bad Request', '<Error><Code>AuthenticationFailed</Code></Error>');
        }
        if (url.includes('sig=BGEN3')) {
          return makeResponse(201, 'Created');
        }
      }
      return makeResponse(201, 'Created');
    });

    const renewFn = vi.fn(async () => {
      renewIdx++;
      return { azureStorageUri: uris[renewIdx], expiresAtMs: Date.now() + 20 * 60_000 };
    });

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; retryBaseDelayMs?: number; maxRenewals?: number }
      ) => Promise<void>;
    };

    await uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: uris[0], expiresAtMs: Date.now() + 10 * 60_000 },
      renewFn,
      undefined,
      { chunkSize: 16, concurrency: 2, retryBaseDelayMs: 0, maxRenewals: 4 }
    );

    expect(renewFn).toHaveBeenCalledTimes(3);
  });

  it('continues using an unexpired SAS and backs off when proactive renewal fails transiently', async () => {
    const filePath = createTempFile(32); // 2 x 16-byte chunks
    const baseNow = Date.parse('2026-11-27T16:00:00.000Z');
    const currentUri = 'https://blob.example.test/c/b?sig=STILL_VALID';
    const fetchMock = vi.fn(async () => makeResponse(201, 'Created'));
    const renewFn = vi.fn(async () => {
      throw new Error('Graph API POST failed: 503 - Service Unavailable');
    });

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; now?: () => number; retryBaseDelayMs?: number }
      ) => Promise<void>;
    };

    // 90s remaining: within 2-minute proactive buffer, but not yet expired
    await uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: currentUri, expiresAtMs: baseNow + 90_000 },
      renewFn,
      undefined,
      { chunkSize: 16, concurrency: 1, now: () => baseNow, retryBaseDelayMs: 0 }
    );

    // Proactive renewal attempted once, backed off for subsequent blocks/commit, upload succeeded on current SAS
    expect(renewFn).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 2 blocks + blocklist commit
  });

  it('joins an in-flight renewal on 403 even when authRenewalAttempt budget was already used', async () => {
    const filePath = createTempFile(32); // 2 x 16-byte chunks
    const uris = [
      'https://blob.example.test/c/b?sig=JGEN0',
      'https://blob.example.test/c/b?sig=JGEN1',
      'https://blob.example.test/c/b?sig=JGEN2',
      'https://blob.example.test/c/b?sig=JGEN3',
    ];
    let renewIdx = 0;

    let releaseBlock1ToJoin!: () => void;
    const block1CanFailOnGen2 = new Promise<void>((r) => { releaseBlock1ToJoin = r; });
    let block1ReturnedGen2!: () => void;
    const block1Gen2Returned = new Promise<void>((r) => { block1ReturnedGen2 = r; });
    let releaseRenewal3!: () => void;
    const renewal3Gate = new Promise<void>((r) => { releaseRenewal3 = r; });
    let block0Gen2Arrived!: () => void;
    const block0Gen2Ready = new Promise<void>((r) => { block0Gen2Arrived = r; });

    const blockId0 = encodeURIComponent(Buffer.from('000000').toString('base64'));
    const blockId1 = encodeURIComponent(Buffer.from('000001').toString('base64'));

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(`blockid=${blockId1}`)) {
        // Block 1 triggers two genuine renewals (spends authRenewalAttempt = 1 and 2)
        if (url.includes('sig=JGEN0') || url.includes('sig=JGEN1')) {
          return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
        }
        // On GEN2, wait until block 0 has started in-flight renewal 3, then return 403 on GEN2
        if (url.includes('sig=JGEN2')) {
          await block1CanFailOnGen2;
          block1ReturnedGen2();
          return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
        }
        if (url.includes('sig=JGEN3')) {
          return makeResponse(201, 'Created');
        }
      }
      if (url.includes(`blockid=${blockId0}`)) {
        if (url.includes('sig=JGEN0') || url.includes('sig=JGEN1')) {
          // Wait until block 1 moves past GEN0/GEN1 by returning 403 only after GEN2
          await block0Gen2Ready;
          return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
        }
        if (url.includes('sig=JGEN2')) {
          return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
        }
        if (url.includes('sig=JGEN3')) {
          return makeResponse(201, 'Created');
        }
      }
      return makeResponse(201, 'Created');
    });

    const renewFn = vi.fn(async () => {
      renewIdx++;
      if (renewIdx === 2) {
        block0Gen2Arrived();
      }
      if (renewIdx === 3) {
        // Renewal 3 is now inFlightRenewal while currentGeneration is still 2
        releaseBlock1ToJoin();
        await renewal3Gate;
      }
      return { azureStorageUri: uris[renewIdx], expiresAtMs: Date.now() + 20 * 60_000 };
    });

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; retryBaseDelayMs?: number; maxRenewals?: number }
      ) => Promise<void>;
    };

    // Release renewal 3 deterministically after block 1 returns 403 and joins inFlightRenewal
    const runPromise = uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: uris[0], expiresAtMs: Date.now() + 10 * 60_000 },
      renewFn,
      undefined,
      { chunkSize: 16, concurrency: 2, retryBaseDelayMs: 0, maxRenewals: 5 }
    );
    await block1Gen2Returned;
    await new Promise((r) => setImmediate(r));
    releaseRenewal3();
    await runPromise;

    expect(renewFn).toHaveBeenCalledTimes(3);
  });

  it('does not invoke renewUri a second time when an in-flight reactive renewal rejects under concurrent 403s', async () => {
    const filePath = createTempFile(32); // 2 x 16-byte chunks
    let markBlock1InFetch!: () => void;
    const block1InFetch = new Promise<void>((r) => { markBlock1InFetch = r; });
    let releaseBlock1!: () => void;
    const block1CanFail = new Promise<void>((r) => { releaseBlock1 = r; });
    let block1Returned!: () => void;
    const block1DidReturn = new Promise<void>((r) => { block1Returned = r; });
    let rejectRenewal!: () => void;
    const renewalGate = new Promise<void>((r) => { rejectRenewal = r; });

    const blockId1 = encodeURIComponent(Buffer.from('000001').toString('base64'));
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(`blockid=${blockId1}`)) {
        markBlock1InFetch();
        await block1CanFail;
        block1Returned();
        return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
      }
      // Wait until block 1 is already inside fetch with GEN0 so both workers
      // hit the 403 reactive path concurrently and block 1 joins inFlightRenewal.
      await block1InFetch;
      return makeResponse(403, 'AuthenticationFailed', 'AuthenticationFailed');
    });

    const renewFn = vi.fn(async () => {
      // Renewal is now inFlightRenewal; let block 1 fail with 403 and join it before rejecting
      releaseBlock1();
      await renewalGate;
      throw new Error('Graph API POST failed: 503 - Service Unavailable');
    });

    const uploader = new IntuneUploader(makeConfig(fetchMock)) as unknown as {
      uploadFileChunks: (
        filePath: string,
        session: { azureStorageUri: string; expiresAtMs?: number },
        renewUri: (prev: { azureStorageUri: string; expiresAtMs?: number }) => Promise<{ azureStorageUri: string; expiresAtMs?: number }>,
        onProgress?: (percent: number) => Promise<void>,
        options?: { chunkSize?: number; concurrency?: number; retryBaseDelayMs?: number }
      ) => Promise<void>;
    };

    const runPromise = uploader.uploadFileChunks(
      filePath,
      { azureStorageUri: 'https://blob.example.test/c/b?sig=EXPIRED', expiresAtMs: Date.now() + 10 * 60_000 },
      renewFn,
      undefined,
      { chunkSize: 16, concurrency: 2, retryBaseDelayMs: 0 }
    );
    await block1DidReturn;
    await new Promise((r) => setImmediate(r));
    rejectRenewal();

    await expect(runPromise).rejects.toThrow('Graph API POST failed: 503 - Service Unavailable');
    expect(renewFn).toHaveBeenCalledTimes(1);
  });
});
