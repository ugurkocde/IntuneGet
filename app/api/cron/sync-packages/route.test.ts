import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  apps: [{ winget_id: 'Example.App', latest_version: '2.0', description: 'Example', upstream_miss_count: 0 }],
  metadata: {} as Record<string, unknown>,
  writes: [] as Array<{ table: string; value: Record<string, unknown> }>,
  historyError: null as { message: string } | null,
  appError: null as { message: string } | null,
  client: {
    fetchVersionsWithValidator: vi.fn(), fetchVersions: vi.fn(),
    fetchInstallerManifest: vi.fn(), fetchLocaleManifest: vi.fn(),
  },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (table: string) => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { metadata: mocks.metadata }, error: null }) }) }),
  upsert: async (value: Record<string, unknown>) => {
    mocks.writes.push({ table, value });
    return { error: table === 'version_history' ? mocks.historyError : null };
  },
  update: (value: Record<string, unknown>) => ({ eq: async () => {
    mocks.writes.push({ table, value }); return { error: mocks.appError };
  } }),
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
  mocks.writes = []; mocks.historyError = null; mocks.appError = null;
  mocks.client.fetchVersions.mockResolvedValue(['2.0']);
  mocks.client.fetchVersionsWithValidator.mockResolvedValue({ notModified: false, versions: ['2.0'], etag: '"new"' });
  mocks.client.fetchInstallerManifest.mockResolvedValue({ InstallerType: 'exe', Installers: [] });
  mocks.client.fetchLocaleManifest.mockResolvedValue({ ShortDescription: 'Example' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('conditional hourly package sync', () => {
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
