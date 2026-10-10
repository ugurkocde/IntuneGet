import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter, PackagingJob } from '@/lib/db/types';
import { findPendingApprovalBlocks } from '@/lib/intune-approval-guard';
import { acquireGraphToken } from '@/lib/graph-token';

vi.mock('@/lib/db', () => ({ getDatabase: vi.fn() }));
vi.mock('@/lib/graph-token', () => ({ acquireGraphToken: vi.fn() }));
const appId = '11111111-1111-1111-1111-111111111111';
const row = (overrides: Partial<PackagingJob> = {}): PackagingJob => ({
  id: '22222222-2222-2222-2222-222222222222', tenant_id: 'tenant', user_id: 'other-user',
  winget_id: 'Vendor.App', version: '1.0', status: 'failed', error_category: 'approval',
  error_details: { intuneAppId: appId }, archived_at: '2026-10-07T00:00:00Z',
  created_at: '2026-10-07T00:00:00Z', ...overrides,
} as PackagingJob);
const input = { tenantId: 'tenant', wingetIds: ['Vendor.App'] };
const dbFor = (getApprovalFailures: ReturnType<typeof vi.fn>) =>
  ({ jobs: { getApprovalFailures } } as unknown as DatabaseAdapter);

beforeEach(() => { vi.clearAllMocks(); vi.mocked(acquireGraphToken).mockResolvedValue({ accessToken: 'test-token', expiresIn: 3600 }); });
afterEach(() => vi.unstubAllGlobals());

describe('optional approval cancellation and aggregate budgets', () => {
  it('does not read or probe when already cancelled', async () => {
    const controller = new AbortController(); controller.abort();
    const query = vi.fn().mockResolvedValue([]); const probe = vi.fn();
    expect(await findPendingApprovalBlocks(input, { db: dbFor(query), signal: controller.signal,
      checkRetainedApp: probe })).toMatchObject([{ reason: 'release_check_failed' }]);
    expect(query).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled();
  });
  it('does not release an empty page that arrives after cancellation', async () => {
    const controller = new AbortController();
    const query = vi.fn().mockImplementation(async () => { controller.abort(); return []; });
    expect(await findPendingApprovalBlocks(input, { db: dbFor(query), signal: controller.signal }))
      .toMatchObject([{ reason: 'release_check_failed' }]);
  });
  it('returns on cancellation of a pending read without probing its delayed result', async () => {
    const controller = new AbortController();
    let finish!: (rows: PackagingJob[]) => void;
    const query = vi.fn().mockImplementation(() => new Promise<PackagingJob[]>(resolve => { finish = resolve; }));
    const probe = vi.fn();
    const pending = findPendingApprovalBlocks(input, { db: dbFor(query), signal: controller.signal, checkRetainedApp: probe });
    await Promise.resolve(); controller.abort();
    expect(await pending).toMatchObject([{ reason: 'release_check_failed' }]);
    finish([row()]); await Promise.resolve(); expect(probe).not.toHaveBeenCalled();
  });
  it('propagates cancellation to the active Graph fetch and stops further probes', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(async (_url, options) => {
      const signal = options.signal as AbortSignal;
      controller.abort(); signal.throwIfAborted();
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await findPendingApprovalBlocks(input, { db: dbFor(vi.fn().mockResolvedValue([row(), row()])),
      signal: controller.signal })).toMatchObject([{ reason: 'release_check_failed' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('cannot begin a Graph fetch after a delayed token read was cancelled', async () => {
    const controller = new AbortController();
    let finish!: (token: { accessToken: string; expiresIn: number }) => void;
    vi.mocked(acquireGraphToken).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const pending = findPendingApprovalBlocks(input, { db: dbFor(vi.fn().mockResolvedValue([row()])), signal: controller.signal });
    for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
    expect(finish).toBeDefined(); controller.abort();
    expect(await pending).toMatchObject([{ reason: 'release_check_failed' }]);
    finish({ accessToken: 'test-token', expiresIn: 3600 });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([0, -1, NaN, 1.5])('fails closed before a probe with invalid/exhausted budget %s', async remaining => {
    const probe = vi.fn().mockResolvedValue('absent');
    expect(await findPendingApprovalBlocks(input, { db: dbFor(vi.fn().mockResolvedValue([row()])),
      checkRetainedApp: probe, probeBudget: { remaining } })).toMatchObject([{ reason: 'release_check_failed' }]);
    expect(probe).not.toHaveBeenCalled();
  });
  it('shares the budget across calls and does not charge duplicate app identities twice', async () => {
    const budget = { remaining: 1 }; const probe = vi.fn().mockResolvedValue('absent');
    const deps = { db: dbFor(vi.fn().mockResolvedValue([row(), row()])), checkRetainedApp: probe, probeBudget: budget };
    expect(await findPendingApprovalBlocks(input, deps)).toEqual([]);
    expect(budget.remaining).toBe(0); expect(probe).toHaveBeenCalledTimes(1);
    expect(await findPendingApprovalBlocks(input, deps)).toMatchObject([{ reason: 'release_check_failed' }]);
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it('rejects an absent probe result received after cancellation', async () => {
    const controller = new AbortController();
    const probe = vi.fn().mockImplementation(async () => { controller.abort(); return 'absent'; });
    expect(await findPendingApprovalBlocks(input, { db: dbFor(vi.fn().mockResolvedValue([row()])),
      signal: controller.signal, checkRetainedApp: probe })).toMatchObject([{ reason: 'release_check_failed' }]);
  });
});

describe('pending Intune approval guard', () => {
  it.each(['present', 'absent', 'unknown'] as const)('reconciles cancelled approval checkpoints with retained state %s', async state => {
    const probe = vi.fn().mockResolvedValue(state);
    const result = await findPendingApprovalBlocks(input, {
      db: dbFor(vi.fn().mockResolvedValue([row({ status: 'cancelled' })])), checkRetainedApp: probe,
    });
    expect(probe).toHaveBeenCalledWith('tenant', appId);
    expect(result).toEqual(state === 'absent' ? [] : [expect.objectContaining({
      reason: state === 'present' ? 'retained_app_present' : 'release_check_failed',
    })]);
  });
  it.each(['deployed', 'queued', 'uploading'] as const)('rejects unsupported checkpoint status %s without probing Graph', async status => {
    const probe = vi.fn();
    expect(await findPendingApprovalBlocks(input, {
      db: dbFor(vi.fn().mockResolvedValue([row({ status })])), checkRetainedApp: probe,
    })).toMatchObject([{ reason: 'release_check_failed' }]);
    expect(probe).not.toHaveBeenCalled();
  });
  it('blocks retained apps across users, versions and dismissed checkpoints', async () => {
    const query = vi.fn().mockResolvedValue([row()]);
    const probe = vi.fn().mockResolvedValue('present');
    const blocks = await findPendingApprovalBlocks(input, { db: dbFor(query), checkRetainedApp: probe });
    expect(blocks).toMatchObject([{ code: 'INTUNE_APPROVAL_PENDING', reason: 'retained_app_present' }]);
    expect(query).toHaveBeenCalledWith('tenant', 'Vendor.App', undefined);
    expect(probe).toHaveBeenCalledWith('tenant', appId);
    expect(JSON.stringify(blocks)).not.toContain('other-user');
    expect(JSON.stringify(blocks)).not.toContain(appId);
  });

  it.each([null, {}, { intuneAppId: '../other' }])('blocks missing or malformed callback IDs without trusting the deployed column: %j', async details => {
    const probe = vi.fn();
    const query = vi.fn().mockResolvedValue([row({ error_category: 'system', error_code: 'INTUNE_APPROVAL_REQUIRED',
      error_details: details, intune_app_id: appId })]);
    expect(await findPendingApprovalBlocks(input, { db: dbFor(query), checkRetainedApp: probe }))
      .toMatchObject([{ reason: 'retained_app_unverified' }]);
    expect(probe).not.toHaveBeenCalled();
  });

  it('does not release a tenant using a row from another tenant', async () => {
    const probe = vi.fn().mockResolvedValue('absent');
    expect(await findPendingApprovalBlocks(input, { db: dbFor(vi.fn().mockResolvedValue([row({ tenant_id: 'other' })])), checkRetainedApp: probe }))
      .toMatchObject([{ reason: 'release_check_failed' }]);
    expect(probe).not.toHaveBeenCalled();
  });

  it('deduplicates retained IDs and follows the keyset cursor to an older blocker', async () => {
    const first = Array.from({ length: 100 }, () => row());
    const query = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce([row({ error_details: null })]);
    const probe = vi.fn().mockResolvedValue('absent');
    expect(await findPendingApprovalBlocks(input, { db: dbFor(query), checkRetainedApp: probe }))
      .toMatchObject([{ reason: 'retained_app_unverified' }]);
    expect(query).toHaveBeenLastCalledWith('tenant', 'Vendor.App', { createdAt: first[99].created_at, id: first[99].id });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('fails closed on query overflow and caps distinct Graph reads', async () => {
    const many = Array.from({ length: 21 }, (_, i) => row({ error_details: { intuneAppId: `${String(i).padStart(8,'0')}-1111-1111-1111-111111111111` } }));
    const probe = vi.fn().mockResolvedValue('absent');
    expect(await findPendingApprovalBlocks(input, { db: dbFor(vi.fn().mockResolvedValue(many)), checkRetainedApp: probe }))
      .toMatchObject([{ reason: 'release_check_failed' }]);
    expect(probe).toHaveBeenCalledTimes(20);
    let page = 0;
    const query = vi.fn().mockImplementation(async () => Array.from({ length: 100 }, () => row({ id: `${String(page++).padStart(8, '0')}-1111-1111-1111-111111111111` })));
    expect(await findPendingApprovalBlocks(input, { db: dbFor(query), checkRetainedApp: vi.fn().mockResolvedValue('absent') }))
      .toMatchObject([{ reason: 'release_check_failed' }]);
    expect(query).toHaveBeenCalledTimes(10);
  });

  it.each([200, 401, 403, 429, 500])('blocks Graph status %s using the application token path', async status => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: appId }), { status }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await findPendingApprovalBlocks(input, { db: dbFor(vi.fn().mockResolvedValue([row()])) })).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(`https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/${appId}?$select=id`,
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }));
    expect(acquireGraphToken).toHaveBeenCalledWith('tenant');
  });

  it('releases only when every retained app is confirmed absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    expect(await findPendingApprovalBlocks(input, { db: dbFor(vi.fn().mockResolvedValue([row()])) })).toEqual([]);
  });

  it.each(['token', 'network', 'invalid200', 'database'])('fails closed without publishing raw failures: %s', async mode => {
    const query = vi.fn().mockResolvedValue([row()]);
    if (mode === 'token') vi.mocked(acquireGraphToken).mockRejectedValue(new Error('sensitive token diagnostic'));
    if (mode === 'database') query.mockRejectedValue(new Error('sensitive database diagnostic'));
    vi.stubGlobal('fetch', mode === 'network' ? vi.fn().mockRejectedValue(new Error('sensitive request diagnostic'))
      : vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const result = await findPendingApprovalBlocks(input, { db: dbFor(query) });
    expect(result).toMatchObject([{ reason: 'release_check_failed' }]);
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });
});
