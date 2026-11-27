import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  apps: [{ winget_id: 'Example.App', latest_version: '2.0', description: 'Example', upstream_miss_count: 0 }] as Array<Record<string, unknown>>,
  metadata: {} as Record<string, unknown>,
  writes: [] as Array<{ table: string; value: Record<string, unknown> }>,
  deletes: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  historyError: null as { message: string } | null,
  appError: null as { message: string } | null,
  rpc: vi.fn(),
  cacheRefresh: vi.fn(),
  client: {
    fetchVersionsWithValidator: vi.fn(), fetchVersions: vi.fn(),
    fetchInstallerManifest: vi.fn(), fetchLocaleManifest: vi.fn(),
  },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mocks.rpc, from: (table: string) => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { metadata: mocks.metadata }, error: null }) }) }),
  upsert: async (value: Record<string, unknown>) => {
    mocks.writes.push({ table, value });
    return { error: table === 'version_history' ? mocks.historyError : null };
  },
  update: (value: Record<string, unknown>) => ({ eq: async () => {
    mocks.writes.push({ table, value }); return { error: mocks.appError };
  } }),
  delete: () => {
    const filters: Record<string, unknown> = {};
    const chain = {
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        if (Object.keys(filters).length < 2) return chain;
        mocks.deletes.push({ table, filters });
        return Promise.resolve({ error: null });
      },
    };
    return chain;
  },
}) }) }));
vi.mock('./select-apps', () => ({ selectAppsToSync: async () => mocks.apps }));
vi.mock('@/lib/winget-sync-resolution.mjs', async (original) => ({
  ...await original<object>(), createWingetManifestClient: () => mocks.client,
}));
vi.mock('@/lib/manifest-api', () => ({
  normalizeManifestInstallers: () => [{ Architecture: 'x64', InstallerUrl: 'https://example.test/app.exe', InstallerSha256: 'FAKE' }],
  normalizeInstaller: () => ({ silentArgs: '/quiet' }),
}));

const fetchedAt = '2026-10-18T12:00:00.000Z';
const entry = () => ({ etag: '"old"', version: '2.0', fetchedAt, deriv: 1 });
const request = () => new Request('https://example.test/api/cron/sync-packages', { headers: { authorization: 'Bearer cron-test' } });
const completion = () => mocks.writes.findLast(w => w.table === 'curated_sync_status' && w.value.metadata)?.value;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-18T13:00:00.000Z'); vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'cron-test'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-key');
  vi.stubEnv('GITHUB_PAT', 'fake-token');
  mocks.apps = [{ winget_id: 'Example.App', latest_version: '2.0', description: 'Example', upstream_miss_count: 0 }];
  mocks.metadata = { upstream_etags: { 'Example.App': entry(), 'Not.Selected': entry() } };
  mocks.writes = []; mocks.deletes = []; mocks.historyError = null; mocks.appError = null;
  mocks.rpc.mockReturnValue({ abortSignal: mocks.cacheRefresh });
  mocks.cacheRefresh.mockResolvedValue({ data: true, error: null });
  mocks.client.fetchVersions.mockResolvedValue(['2.0']);
  mocks.client.fetchVersionsWithValidator.mockResolvedValue({ notModified: false, versions: ['2.0'], etag: '"new"' });
  mocks.client.fetchInstallerManifest.mockResolvedValue({ InstallerType: 'exe', Installers: [] });
  mocks.client.fetchLocaleManifest.mockResolvedValue({ ShortDescription: 'Example' });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('conditional hourly package sync', () => {
  it('returns the sync result without starting refresh at the invocation deadline', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(299500);
    expect((await GET(request())).status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('caps refresh to the remaining budget and returns after the final write', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(298000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    mocks.rpc.mockImplementation(() => {
      expect(completion()).toBeDefined();
      return { abortSignal: mocks.cacheRefresh };
    });
    expect((await GET(request())).status).toBe(200);
    expect(timeout).toHaveBeenCalledWith(1000);
  });

  it('refreshes history metadata with a 10s client budget without changing sync results', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(34_000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    expect((await GET(request())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('refresh_catalog_release_history_cache');
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(mocks.cacheRefresh).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('logs redacted SQLSTATE and timing when metadata refresh returns an RPC error without changing sync success', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1_000).mockReturnValueOnce(1_000).mockReturnValue(9_012);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.cacheRefresh.mockResolvedValue({
      data: null,
      error: { code: '57014', message: 'canceling statement due to statement timeout secret=tenant-123' },
    });
    expect((await GET(request())).status).toBe(200);
    expect(mocks.cacheRefresh).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Catalog history metadata refresh deferred', {
      elapsedMs: 8012,
      budgetMs: 10_000,
      outcome: 'rpc_error',
      code: '57014',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('tenant-123');
  });

  it('drops unsafe RPC error codes when logging metadata refresh deferral', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.cacheRefresh.mockResolvedValue({
      data: null,
      error: { code: 'bad code with spaces!', message: 'synthetic unavailable' },
    });
    expect((await GET(request())).status).toBe(200);
    expect(warn).toHaveBeenCalledWith('Catalog history metadata refresh deferred', expect.objectContaining({
      outcome: 'rpc_error',
      code: null,
    }));
  });

  it('classifies an aborted client timeout returned as an SDK error without leaking message text', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.cacheRefresh.mockImplementation(async () => {
      controller.abort(new DOMException('timed out', 'TimeoutError'));
      return { data: null, error: { code: '20', message: 'AbortError: signal timed out' } };
    });
    expect((await GET(request())).status).toBe(200);
    expect(warn).toHaveBeenCalledWith('Catalog history metadata refresh deferred', expect.objectContaining({
      budgetMs: 10_000,
      outcome: 'timeout',
      code: null,
    }));
  });

  it('keeps sync success and logs redacted outcome when the optional metadata refresh throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.cacheRefresh.mockRejectedValue(new Error('synthetic network failure token=abc'));
    expect((await GET(request())).status).toBe(200);
    expect(mocks.cacheRefresh).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Catalog history metadata refresh deferred', expect.objectContaining({
      budgetMs: 10_000,
      outcome: 'error',
      code: null,
    }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('token=abc');
  });

  it('classifies a thrown TimeoutError as timeout deferral', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.cacheRefresh.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    expect((await GET(request())).status).toBe(200);
    expect(warn).toHaveBeenCalledWith('Catalog history metadata refresh deferred', expect.objectContaining({
      outcome: 'timeout',
      code: null,
    }));
  });

  it('tries metadata refresh after a partial write failure without hiding that failure', async () => {
    mocks.appError = { message: 'synthetic application update failure' };
    expect((await GET(request())).status).toBe(500);
    expect(mocks.rpc).toHaveBeenCalledWith('refresh_catalog_release_history_cache');
  });

  it('skips unchanged packages without renewing the full refresh deadline or writing derived rows', async () => {
    mocks.client.fetchVersionsWithValidator.mockResolvedValue({ notModified: true, versions: [], etag: '"old"' });
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ success: true, synced: 0, skipped: 1, failed: 0 });
    expect(mocks.client.fetchVersionsWithValidator).toHaveBeenCalledWith('Example.App', '"old"');
    expect(mocks.client.fetchInstallerManifest).not.toHaveBeenCalled();
    expect(mocks.client.fetchLocaleManifest).not.toHaveBeenCalled();
    expect(mocks.writes.every(w => w.table === 'curated_sync_status')).toBe(true);
    expect(completion()?.metadata).toMatchObject({ cache_hits: 1, validators_sent: 1, upstream_etags: { 'Example.App': entry() } });
    expect((completion()?.metadata as Record<string, unknown>).upstream_etags).not.toHaveProperty('Not.Selected');
  });

  it('fetches a changed directory once and acknowledges it only after both derived writes succeed', async () => {
    expect((await GET(request())).status).toBe(200);
    expect(mocks.client.fetchVersionsWithValidator).toHaveBeenCalledTimes(1);
    expect(mocks.client.fetchVersions).not.toHaveBeenCalled();
    expect(mocks.client.fetchInstallerManifest).toHaveBeenCalledWith('Example.App', '2.0');
    expect(completion()?.metadata).toMatchObject({ upstream_etags: { 'Example.App': { etag: '"new"', fetchedAt: '2026-10-18T13:00:00.000Z', version: '2.0', deriv: 1 } } });
  });

  it.each(['historyError', 'appError'] as const)('does not retain a validator after a %s write failure', async field => {
    mocks[field] = { message: 'synthetic failure' };
    expect((await GET(request())).status).toBe(500);
    expect(completion()?.metadata).toMatchObject({ upstream_etags: {} });
  });

  it.each([
    { deriv: 0 }, { fetchedAt: '2026-10-17T12:59:59.000Z' }, { fetchedAt: '2026-10-19T00:00:00.000Z' },
    { fetchedAt: 'invalid' }, { etag: '*'}, { etag: '"bad\r\nheader"' }, { version: '1.0' },
  ])('ignores a stale or corrupt validator %j', async change => {
    mocks.metadata = { upstream_etags: { 'Example.App': { ...entry(), ...change } } };
    await GET(request());
    expect(mocks.client.fetchVersionsWithValidator).toHaveBeenCalledWith('Example.App', null);
    expect(mocks.client.fetchInstallerManifest).toHaveBeenCalledTimes(1);
  });

  it('does not conditionally skip an unsynced app or inherit object prototype keys', async () => {
    mocks.apps[0].latest_version = null as unknown as string;
    mocks.metadata = { upstream_etags: Object.create({ 'Example.App': entry() }) };
    await GET(request());
    expect(mocks.client.fetchVersionsWithValidator).toHaveBeenCalledWith('Example.App', null);
  });

  it('does not acknowledge missing packages or responses without a usable ETag', async () => {
    mocks.client.fetchVersionsWithValidator.mockResolvedValue({ notModified: false, versions: [], etag: null });
    expect(await (await GET(request())).json()).toMatchObject({ unavailable: 1, skipped: 0 });
    expect(completion()?.metadata).toMatchObject({ upstream_etags: {} });
  });
});

describe('upstream_removed recovery', () => {
  const blockedApp = () => ({ winget_id: 'Example.App', latest_version: '2.0', description: 'Example',
    upstream_miss_count: 3, upstream_removed_block: true });

  it('lifts the block and re-verifies an app that resolves again, without a conditional request', async () => {
    mocks.apps = [blockedApp()];
    expect(await (await GET(request())).json()).toMatchObject({ synced: 1, unavailable: 0 });
    expect(mocks.client.fetchVersionsWithValidator).toHaveBeenCalledWith('Example.App', null);
    expect(mocks.deletes).toEqual([{ table: 'package_eligibility_blocks',
      filters: { winget_id: 'Example.App', block_code: 'upstream_removed' } }]);
    expect(mocks.writes.find(w => w.table === 'curated_apps')?.value)
      .toMatchObject({ is_verified: true, upstream_miss_count: 0 });
  });

  it('keeps the block while the package is still missing', async () => {
    mocks.apps = [blockedApp()];
    mocks.client.fetchVersionsWithValidator.mockResolvedValue({ notModified: false, versions: [], etag: null });
    expect(await (await GET(request())).json()).toMatchObject({ unavailable: 1 });
    expect(mocks.deletes).toEqual([]);
    expect(mocks.writes.some(w => w.table === 'curated_apps' && 'is_verified' in w.value)).toBe(false);
  });

  it('does not touch eligibility for an unblocked app', async () => {
    await GET(request());
    expect(mocks.deletes).toEqual([]);
    expect(mocks.writes.find(w => w.table === 'curated_apps')?.value).not.toHaveProperty('is_verified');
  });
});
