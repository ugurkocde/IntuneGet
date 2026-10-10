import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ client: vi.fn(), guard: vi.fn(), flags: vi.fn(),
  dispatch: vi.fn(), licence: vi.fn(), completion: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ createServerClient: mocks.client }));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({}) }));
vi.mock('@/lib/intune-approval-guard', () => ({ findPendingApprovalBlocks: mocks.guard }));
vi.mock('@/lib/features', () => ({ getFeatureFlags: mocks.flags }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => ({ app: { url: 'https://example.test' } }) }));
vi.mock('@/lib/github-actions', () => ({ triggerPackagingWorkflow: mocks.dispatch }));
vi.mock('@/lib/auto-update/cleanup', () => ({ handleAutoUpdateJobCompletion: mocks.completion }));
vi.mock('@/lib/curated-catalog/licence', () => ({ assertCuratedLicenceAccepted: mocks.licence,
  CuratedLicenceError: class extends Error {} }));
vi.mock('@/lib/qa/demand', () => ({ ensureQaDemand: vi.fn() }));
vi.mock('@/lib/catalog-installer-reconciliation', () => ({ reconcileCatalogInstaller: vi.fn() }));
import { GET } from './route';
import * as packageEligibility from '@/lib/package-eligibility';

type Row = Record<string, unknown> & { id: string; status: string; qa_resume_due_at: string };
const epoch = Date.parse('2026-10-08T00:00:00Z');
function job(i: number, extra: Record<string, unknown> = {}): Row {
  return { id: String(i).padStart(4, '0'), tenant_id: 'tenant-a', winget_id: 'Vendor.App',
    version: '1.0',
    status: 'awaiting_qa', created_at: new Date(epoch - 60_000 + i).toISOString(),
    qa_resume_due_at: new Date(epoch - 60_000 + i).toISOString(), qa_candidate_id: 'candidate',
    is_auto_update: false, package_config: { sourceType: 'winget', version: '1.0', installerType: 'exe' }, ...extra };
}
// Exercises actual selection, conditional writes and persistent rotation over cycles.
function database(rows: Row[], candidateStatus = 'passed') {
  const writes: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const client = { from(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const orders: string[] = [];
    let cap = Infinity;
    let patch: Record<string, unknown> | undefined;
    const execute = () => {
      const source = table === 'packaging_jobs' ? rows : table === 'qa_candidates'
        ? [{ id: 'candidate', status: candidateStatus, package_profile_sha256: 'profile' }]
        : [{ outcome: 'Passed', package_profile_sha256: 'profile' }];
      const matches = source.filter(r => filters.every(f => f(r)))
        .sort((a, b) => {
          for (const key of orders) {
            const n = String(a[key]).localeCompare(String(b[key]));
            if (n) return n;
          }
          return 0;
        }).slice(0, cap);
      if (patch) for (const r of matches) {
        writes.push({ id: String(r.id), patch: { ...patch } });
        Object.assign(r, patch);
      }
      return { data: matches.map(r => ({ ...r })), error: null };
    };
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => { filters.push(r => r[key] === value); return builder; },
      lte: (key: string, value: string) => { filters.push(r => String(r[key]) <= value); return builder; },
      in: (key: string, values: unknown[]) => { filters.push(r => values.includes(r[key])); return builder; },
      order: (key: string) => { orders.push(key); return builder; },
      limit: (n: number) => { cap = n; return builder; },
      update: (p: Record<string, unknown>) => { patch = p; return builder; },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data[0] || null }; },
      then: (resolve: (v: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
    };
    return builder;
  } };
  mocks.client.mockReturnValue(client);
  return writes;
}
async function cycle() {
  return (await GET(new Request('https://example.test/api/cron/qa-resume', {
    headers: { authorization: 'Bearer test-secret' },
  }))).json();
}
const blocked = (reason = 'retained_app_present') => [{ wingetId: 'Vendor.App',
  code: 'INTUNE_APPROVAL_PENDING', reason, message: 'Resolve the earlier deployment approval.' }];

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(epoch);
  process.env.CRON_SECRET = 'test-secret';
  delete process.env.QA_MAINTENANCE_MODE; delete process.env.QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL;
  mocks.flags.mockReturnValue({ localPackager: true }); mocks.guard.mockResolvedValue([]);
  mocks.licence.mockResolvedValue(null); mocks.dispatch.mockResolvedValue({ runId: 123 });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks();
  delete process.env.QA_MAINTENANCE_MODE; delete process.env.QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL; });

describe('approval holds and fair QA release', () => {
  it('rotates unavailable compatibility lookups without releasing them or starving the next job', async () => {
    const rows = [...Array.from({ length: 25 }, (_, i) => job(i, { winget_id: 'Fixture.Unverified' })),
      job(26, { winget_id: 'Fixture.Verified' })];
    database(rows);
    vi.spyOn(packageEligibility, 'getPackageCompatibilityBlock').mockImplementation(async (_client, input) => {
      if (input.wingetId === 'Fixture.Unverified') throw new Error('Synthetic lookup failure');
      return null;
    });
    expect(await cycle()).toMatchObject({ waiting: 25, resumed: 0, failed: 0 });
    expect(rows.slice(0, 25).every(row => row.status === 'awaiting_qa' && row.qa_resume_due_at === new Date(epoch + 60_000).toISOString())).toBe(true);
    expect(mocks.guard).not.toHaveBeenCalled();
    vi.setSystemTime(epoch + 1000);
    expect(await cycle()).toMatchObject({ resumed: 1, waiting: 0 });
    expect(rows[25].status).toBe('queued');
    expect(rows.slice(0, 25).every(row => row.status === 'awaiting_qa')).toBe(true);
  });
  it.each([true, false])('holds every unresolved reason without releasing local=%s', async local => {
    mocks.flags.mockReturnValue({ localPackager: local });
    for (const reason of ['retained_app_present', 'retained_app_unverified', 'release_check_failed']) {
      const rows = [job(1, { is_auto_update: true })]; const writes = database(rows);
      mocks.guard.mockResolvedValue(blocked(reason));
      expect(await cycle()).toMatchObject({ held: 1, resumed: 0, failed: 0 });
      expect(rows[0].status).toBe('awaiting_qa');
      expect(writes).toEqual([{ id: rows[0].id, patch: {
        status_message: blocked()[0].message,
        qa_resume_due_at: new Date(epoch + (reason === 'retained_app_present' ? 600_000 : 300_000)).toISOString(),
      } }]);
    }
    expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.completion).not.toHaveBeenCalled();
  });
  it.each(['maintenance', 'deferred'])('checks the guard even when QA is bypassed by %s', async mode => {
    if (mode === 'maintenance') process.env.QA_MAINTENANCE_MODE = 'true';
    else process.env.QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL = new Date(epoch + 3_600_000).toISOString();
    database([job(1)], 'queued'); mocks.guard.mockResolvedValue(blocked());
    expect(await cycle()).toMatchObject({ held: 1, resumed: 0 });
  });
  it('rotates over 25 held jobs and releases another tenant on the next cycle', async () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => job(i)), job(31, { tenant_id: 'tenant-b' })];
    database(rows); mocks.guard.mockImplementation(async ({ tenantId }) => tenantId === 'tenant-a' ? blocked() : []);
    expect(await cycle()).toMatchObject({ held: 25, resumed: 0 });
    expect(mocks.guard).toHaveBeenCalledTimes(1);
    vi.setSystemTime(epoch + 60_000);
    expect(await cycle()).toMatchObject({ held: 5, resumed: 1 });
    expect(rows[30].status).toBe('queued');
    expect(mocks.guard).toHaveBeenCalledTimes(3);
  });
  it('rotates QA waiting rows too, without probing them', async () => {
    const rows = [...Array.from({ length: 25 }, (_, i) => job(i)), job(26)];
    database(rows, 'queued'); expect(await cycle()).toMatchObject({ waiting: 25 });
    expect(mocks.guard).not.toHaveBeenCalled();
    vi.setSystemTime(epoch + 30_000); database(rows);
    expect(await cycle()).toMatchObject({ resumed: 1 }); expect(rows[25].status).toBe('queued');
  });
  it('leaves budget-deferred rows first for a fresh budget next cycle', async () => {
    const rows = Array.from({ length: 27 }, (_, i) => job(i, { tenant_id: `tenant-${i}` }));
    database(rows); mocks.guard.mockImplementation(async (_input, deps) => {
      deps.probeBudget.remaining--; return blocked();
    });
    expect(await cycle()).toMatchObject({ held: 20, deferred: 5, budgetExhausted: true });
    expect(rows[20].qa_resume_due_at).toBe(new Date(epoch - 60_000 + 20).toISOString());
    vi.setSystemTime(epoch + 60_000); mocks.guard.mockResolvedValue([]);
    expect(await cycle()).toMatchObject({ resumed: 7 });
  });
  it('rechecks unknown and retained holds after their separate backoffs', async () => {
    const rows = [job(1)]; database(rows); mocks.guard.mockResolvedValue(blocked('release_check_failed'));
    expect(await cycle()).toMatchObject({ held: 1 });
    vi.setSystemTime(epoch + 299_000); expect(await cycle()).toMatchObject({ scanned: 0 });
    vi.setSystemTime(epoch + 300_000); mocks.guard.mockResolvedValue([]);
    expect(await cycle()).toMatchObject({ resumed: 1 });
  });
  it('holds missing tenant and guard exceptions while other jobs progress', async () => {
    const rows = [job(1, { tenant_id: null }), job(2), job(3, { tenant_id: 'other' })]; database(rows);
    mocks.guard.mockRejectedValueOnce(new Error('private diagnostic')).mockResolvedValueOnce([]);
    expect(await cycle()).toMatchObject({ held: 2, resumed: 1 });
    expect(JSON.stringify(rows)).not.toContain('private diagnostic');
  });
  it('uses tenant and app in the cache key', async () => {
    database([job(1), job(2, { winget_id: 'Vendor.Other' }), job(3, { tenant_id: 'other' })]);
    expect(await cycle()).toMatchObject({ resumed: 3 }); expect(mocks.guard).toHaveBeenCalledTimes(3);
  });
  it('never claims after an aborted check even if it returned a clean result', async () => {
    const controller = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const rows = [job(1), job(2, { tenant_id: 'other' })]; const writes = database(rows);
    mocks.guard.mockImplementation(async () => { controller.abort(); return []; });
    expect(await cycle()).toMatchObject({ held: 1, deferred: 1, budgetExhausted: true });
    expect(writes.every(w => !('status' in w.patch))).toBe(true);
    expect(mocks.guard).toHaveBeenCalledTimes(1);
  });
  it('stops starting new checks after the deadline without moving unreached rows', async () => {
    const rows = [job(1), job(2, { tenant_id: 'other' })]; database(rows);
    mocks.guard.mockImplementation(async () => { vi.setSystemTime(epoch + 31_000); return blocked(); });
    expect(await cycle()).toMatchObject({ held: 1, deferred: 1, budgetExhausted: true });
    expect(rows[1].qa_resume_due_at).toBe(new Date(epoch - 60_000 + 2).toISOString());
  });
  it('preserves cancellation between selection and the hold update', async () => {
    const rows = [job(1)]; const writes = database(rows);
    mocks.guard.mockImplementation(async () => { rows[0].status = 'cancelled'; return blocked(); });
    await cycle(); expect(rows[0].status).toBe('cancelled'); expect(writes).toEqual([]);
  });
  it('releases an approved-absent hosted job and checks after the licence in local mode', async () => {
    database([job(1)]); await cycle();
    expect(mocks.licence.mock.invocationCallOrder[0]).toBeLessThan(mocks.guard.mock.invocationCallOrder[0]);
    mocks.flags.mockReturnValue({ localPackager: false });
    const hosted = [job(2)]; database(hosted);
    expect(await cycle(), JSON.stringify(hosted)).toMatchObject({ resumed: 1, failed: 0 });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });
});
