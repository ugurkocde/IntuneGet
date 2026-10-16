import { afterEach, expect, it, vi } from 'vitest';
import { COMPATIBILITY_BATCH_LIMIT } from '@/lib/package-eligibility';
const mocks = vi.hoisted(() => ({ client: vi.fn(), dispatch: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ createServerClient: mocks.client }));
vi.mock('@/lib/qa/dispatch', () => ({ dispatchQaCandidate: mocks.dispatch }));
vi.mock('@/lib/qa/curated-queue', () => ({ dispatchCuratedQueue: async () => ({ handled: false }) }));
vi.mock('@/lib/qa/live-session-data', () => ({ loadQaLiveCuratedSnapshot: async () => null }));
vi.mock('@/lib/qa/github-actions-health', () => ({ getGitHubActionsHealth: async () => ({ operational: true }) }));
vi.mock('@/lib/qa/github-actions-waiting-runs', () => ({ cancelStaleWaitingQaRuns: async () => [] }));
vi.mock('@/lib/qa/github-actions-run-status', () => ({ isQaWorkflowRunCompleted: async () => false }));
vi.mock('@/lib/qa/github-live-qa-inventory', () => ({ readLiveQaInventory: async () => ({ state: 'complete', inventory: { total_count: 0, workflow_runs: [] } }) }));
import { GET } from '@/app/api/cron/qa-dispatch/route';
import { getQaLiveSnapshot } from './live';
import { buildQaPackageIdentity } from './package-profile';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import { qaSourceKey } from './source-backoff';
function candidate(index: number, priority: number, retry = '-infinity') {
  const input = { profileKind: 'catalog-default' as const, wingetId: `Example.App${index}`, displayName: 'Example', publisher: 'Contoso', version: '1.2.3', architecture: 'x64' as const, installerSha256: 'A'.repeat(64), sourceInstallerType: 'nullsoft', silentArgs: '/S', uninstallCommand: 'REGISTRY_UNINSTALL:Example:/S', installScope: 'machine' as const, nestedInstallerType: '', nestedInstallerFiles: [], psadtConfig: DEFAULT_PSADT_CONFIG, detectionRules: [] };
  const identity = buildQaPackageIdentity(input);
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, winget_id: input.wingetId, version: input.version, architecture: input.architecture as string, installer_sha256: input.installerSha256, installer_url: 'https://example.com/app.exe', package_profile_sha256: identity.packageProfileSha256, test_config: { profileKind: input.profileKind, packageProfileCanonicalJson: identity.canonicalJson, packageProfileSha256: identity.packageProfileSha256 }, priority, enqueued_at: '2026-10-10T12:00:00Z', next_retry_at: retry as string | null, status: 'queued', test_level: 'psadt-package', attempts: 0 };
}
function fixture() {
  const deferred = candidate(1, 2000, '2099-01-01T00:00:00Z'), source = candidate(2, 1000), held = candidate(3, 900), arm = candidate(4, 800), missing = candidate(5, 700), first = candidate(6, 1), second = candidate(7, 1);
  arm.architecture = 'arm64'; missing.next_retry_at = null;
  const rows = [second, missing, arm, held, source, deferred, first], claimed: string[] = [];
  const grants = new Set<string>(), recentRows: Array<Record<string, unknown>> = [];
  let compatibilityReads = 0, sourceReads = 0;
  const errors = new Set<string>();
  const securityHolds: Array<Record<string, unknown>> = [];
  const heldErrors: Array<Record<string, unknown>> = [];
  const blocks: Array<Record<string, unknown>> = [{ winget_id: held.winget_id, version: held.version, architecture: held.architecture, installer_sha256: held.installer_sha256, block_code: 'failed_managed_lifecycle', detail: 'reviewed tuple' }];
  const retries = [{ source_key: qaSourceKey(source), next_retry_at: '2099-01-02T00:00:00Z' }];
  const client = {
    rpc: vi.fn(async (name: string, args: { p_id?: string; p_candidate_id?: string }) => {
      if (name === 'qa_retest_grant_eligible') return { data: grants.has(args.p_candidate_id!), error: errors.has(name) ? { message: 'grant unavailable' } : null };
      if (name === 'refresh_qa_installer_security_holds') return { data: 0, error: null };
      if (name === 'qa_installer_security_waiting_errors') return { data: heldErrors, error: null };
      if (name !== 'claim_qa_work') throw new Error('Unexpected RPC');
      claimed.push(args.p_id!); return { data: { row: rows.find(r => r.id === args.p_id) }, error: null };
    }),
    from(table: string) {
      if (table === 'qa_package_blocks') compatibilityReads++;
      if (table === 'qa_source_backoff') sourceReads++;
      let count = false, cap = Infinity;
      const filters: Array<(r: Record<string, unknown>) => boolean> = [], sort: Array<[string, boolean]> = [];
      const result = () => {
        let data: Array<Record<string, unknown>> = table === 'qa_installer_security_holds' ? securityHolds : table === 'qa_candidates' ? rows : table === 'qa_package_results' ? recentRows : table === 'qa_pipeline_control' ? [{ id: 'global', paused: false }] : table === 'qa_source_backoff' ? retries : table === 'qa_package_blocks' ? blocks : [];
        data = data.filter(r => filters.every(f => f(r)));
        data.sort((a, b) => { for (const [key, ascending] of sort) { const x = a[key] as string | number, y = b[key] as string | number, cmp = x < y ? -1 : x > y ? 1 : 0; if (cmp) return ascending ? cmp : -cmp; } return 0; });
        return { data: data.slice(0, cap), count: count ? data.length : undefined, error: errors.has(table) ? { message: 'lookup unavailable' } : null };
      };
      const builder = {
        select(_columns: string, options?: { count?: string }) { count = !!options?.count; return builder; },
        eq(key: string, value: unknown) { filters.push(r => r[key] === value); return builder; },
        is(key: string, value: unknown) { filters.push(r => r[key] === value); return builder; },
        in(key: string, values: unknown[]) { filters.push(r => values.includes(r[key])); return builder; },
        lte(key: string, value: string) { filters.push(r => r[key] === '-infinity' || (typeof r[key] === 'string' && Date.parse(r[key] as string) <= Date.parse(value))); return builder; },
        order(key: string, options: { ascending: boolean }) { sort.push([key, options.ascending]); return builder; },
        limit(value: number) { cap = value; return builder; }, update() { return builder; }, delete() { return builder; }, or() { return builder; },
        maybeSingle: async () => ({ ...result(), data: result().data[0] || null }),
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return builder;
    },
  };
  return { client, claimed, first, deferred, source, held, rows, errors, blocks, retries, grants, recentRows, securityHolds, heldErrors, compatibilityReads: () => compatibilityReads, sourceReads: () => sourceReads };
}
it('shows an unknown coverage error in waiting without breaking the live snapshot or dispatching it', async () => {
  const f=fixture(); const pending={...f.first,status:'error'};
  f.rows.splice(0,f.rows.length,pending);
  f.heldErrors.push({candidate:pending,malicious:0,nextCheckAt:'2099-01-01T00:00:00Z'});
  f.securityHolds.push({sha256:'a'.repeat(64),malicious_verdicts:0,next_check_at:'2099-01-01T00:00:00Z',released_at:null});
  mocks.client.mockReturnValue(f.client);mocks.dispatch.mockResolvedValue(undefined);process.env.CRON_SECRET='test-secret';
  const live=await getQaLiveSnapshot();
  expect(live.queue.next).toEqual([]);
  expect(live.queue.waiting).toEqual([expect.objectContaining({wingetId:f.first.winget_id,reason:'VirusTotal: awaiting engine coverage, rechecking daily',next_check_at:'2099-01-01T00:00:00Z'})]);
  await GET(new Request('https://example.com/api/cron/qa-dispatch',{headers:{authorization:'Bearer test-secret'}}));
  expect(f.claimed).toEqual([]);expect(mocks.dispatch).not.toHaveBeenCalled();
});
it.each([1, 2])('shows %s malicious verdicts in waiting and never dispatches twice within one minute', async (malicious) => {
  const f = fixture();
  // Every original row shares the refused hash, including other app identities.
  f.securityHolds.push({ sha256: 'a'.repeat(64), malicious_verdicts: malicious, reason: malicious === 1 ? 'VirusTotal: 1 engine flagged, rechecking daily' : 'VirusTotal refused execution for this installer hash.', next_check_at: '2099-01-01T00:00:00Z', released_at: null });
  f.rows.splice(0, f.rows.length, f.first);
  mocks.client.mockReturnValue(f.client); mocks.dispatch.mockResolvedValue(undefined); process.env.CRON_SECRET = 'test-secret';
  const live = await getQaLiveSnapshot();
  expect(live.queue.next).toEqual([]);
  expect(live.queue.waiting[0].reason).toBe(malicious === 1 ? 'VirusTotal: 1 engine flagged, rechecking daily' : 'VirusTotal refused execution for this installer hash.');
  expect(live.queue.waiting[0].next_check_at).toBe('2099-01-01T00:00:00Z');
  for (let retry = 0; retry < 2; retry++) await GET(new Request('https://example.com/api/cron/qa-dispatch', { headers: { authorization: 'Bearer test-secret' } }));
  expect(f.claimed).toEqual([]); expect(mocks.dispatch).not.toHaveBeenCalled();
});
it('keeps queued next visible behind more than 1000 historical errors', async () => {
  const f = fixture();
  f.rows.splice(0,f.rows.length,...Array.from({length:1001},(_,i)=>({...candidate(i+100,2000),status:'error'})),f.first);
  mocks.client.mockReturnValue(f.client);
  expect((await getQaLiveSnapshot()).queue.next[0].wingetId).toBe(f.first.winget_id);
});
it('advertises the granted diagnostic candidate that dispatch actually claims', async () => {
  const f = fixture(); f.grants.add(f.held.id); mocks.client.mockReturnValue(f.client); mocks.dispatch.mockResolvedValue(undefined); process.env.CRON_SECRET = 'test-secret';
  const live = await getQaLiveSnapshot();
  expect(live.queue.next[0].wingetId).toBe(f.held.winget_id);
  const response = await GET(new Request('https://example.com/api/cron/qa-dispatch', { headers: { authorization: 'Bearer test-secret' } }));
  expect((await response.json()).dispatched).toBe(true); expect(f.claimed).toEqual([f.held.id]);
});
it('stops advertising the unverified queue prefix when the grant lookup fails', async () => {
  const f = fixture(); f.errors.add('qa_retest_grant_eligible'); mocks.client.mockReturnValue(f.client);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect((await getQaLiveSnapshot()).queue.next).toEqual([]); warn.mockRestore();
});
for (const unavailable of [false, true]) it(`withholds quarantined Passed recent results with lookup unavailable=${unavailable}`, async () => {
  const f = fixture();
  f.recentRows.push({ winget_id: f.held.winget_id, tested_version: f.held.version, architecture: f.held.architecture, installer_sha256: f.held.installer_sha256, package_profile_sha256: f.held.package_profile_sha256, outcome: 'Passed', tested_at_utc: '2026-10-11T12:00:00Z' });
  f.recentRows.push({ ...f.recentRows[0], outcome: 'Failed', tested_version: '1.2.2' });
  if (unavailable) f.errors.add('qa_package_blocks');
  mocks.client.mockReturnValue(f.client); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect((await getQaLiveSnapshot()).recent.map(r => r.outcome)).toEqual(['Failed']); warn.mockRestore();
});
afterEach(() => { delete process.env.CRON_SECRET; vi.clearAllMocks(); });
it('makes the first public ordinary next row equal the actual dispatch claim with both retry sources and exact compatibility blocks', async () => {
  const f = fixture(); mocks.client.mockReturnValue(f.client); mocks.dispatch.mockResolvedValue(undefined); process.env.CRON_SECRET = 'test-secret';
  const live = await getQaLiveSnapshot();
  expect(live.queue.next[0].wingetId).toBe(f.first.winget_id);
  expect(live.queue.waiting.map(r => r.wingetId)).toEqual([f.deferred.winget_id, f.source.winget_id]);
  expect(live.queue.waiting.map(r => r.next_check_at)).toEqual(['2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z']);
  const response = await GET(new Request('https://example.com/api/cron/qa-dispatch', { headers: { authorization: 'Bearer test-secret' } }));
  expect((await response.json()).dispatched).toBe(true); expect(f.claimed).toEqual([f.first.id]);
  expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ winget_id: live.queue.next[0].wingetId }));
});
it('stops eligibility lookups after filling ten next rows', async () => {
  const f = fixture(); f.rows.splice(0, f.rows.length, ...Array.from({ length: 50 }, (_, i) => candidate(i + 20, 1))); mocks.client.mockReturnValue(f.client);
  expect((await getQaLiveSnapshot()).queue.next).toHaveLength(10); expect(f.compatibilityReads()).toBe(1); expect(f.sourceReads()).toBe(1);
});
it('stops parsing profiles once next and waiting are full', async () => {
  const f = fixture();
  const eligible = Array.from({ length: 25 }, (_, i) => candidate(i + 100, 3));
  const deferred = Array.from({ length: 10 }, (_, i) => candidate(i + 200, 2, '2099-01-01T00:00:00Z'));
  let trailingProfileReads = 0;
  const trailing = Array.from({ length: 50 }, (_, i) => {
    const row = candidate(i + 300, 1), profile = row.test_config;
    Object.defineProperty(row, 'test_config', { get: () => { trailingProfileReads++; return profile; } });
    return row;
  });
  f.rows.splice(0, f.rows.length, ...eligible, ...deferred, ...trailing);
  mocks.client.mockReturnValue(f.client);
  const live = await getQaLiveSnapshot();
  expect(trailingProfileReads).toBe(0);
  expect(live.queue.next.map(row => row.wingetId)).toEqual(eligible.slice(0, 10).map(row => row.winget_id));
  expect(live.queue.waiting.map(row => row.wingetId)).toEqual(deferred.map(row => row.winget_id));
  expect(f.compatibilityReads()).toBe(1); expect(f.sourceReads()).toBe(1);
});

for (const table of ['qa_package_blocks', 'qa_source_backoff']) it(`stops advertising next after ${table} fails`, async () => {
  const f = fixture(); f.errors.add(table); mocks.client.mockReturnValue(f.client);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const live = await getQaLiveSnapshot();
  expect(live.queue.next).toEqual([]); expect(live.queue.waiting.map(x => x.wingetId)).toEqual([f.deferred.winget_id]);
  expect(warn).toHaveBeenCalledWith('[qa-live] eligibility lookup failed', expect.objectContaining({ candidateIds: expect.any(Array) }));
  expect(JSON.stringify(warn.mock.calls)).not.toContain(f.first.winget_id); expect(JSON.stringify(warn.mock.calls)).not.toContain('https://');
  warn.mockRestore();
});
it('filters a cross-product block by its entire immutable tuple', async () => {
  const f = fixture(); f.rows.splice(0, f.rows.length, candidate(30, 1), candidate(31, 1));
  f.blocks.splice(0, f.blocks.length, { winget_id: f.rows[0].winget_id, version: f.rows[0].version, architecture: 'x64', installer_sha256: 'B'.repeat(64) });
  mocks.client.mockReturnValue(f.client); expect((await getQaLiveSnapshot()).queue.next.map(x => x.wingetId)).toEqual(f.rows.map(x => x.winget_id));
});
it('bounds blocked queue lookups and does not advertise beyond the verified prefix', async () => {
  const f = fixture(); f.rows.splice(0, f.rows.length, ...Array.from({ length: 1000 }, (_, i) => candidate(i + 100, 1)));
  f.blocks.splice(0, f.blocks.length, ...f.rows.slice(0, 120).map(x => ({ winget_id: x.winget_id, version: x.version, architecture: x.architecture, installer_sha256: x.installer_sha256 })));
  mocks.client.mockReturnValue(f.client); const live = await getQaLiveSnapshot();
  expect(live.queue.next).toEqual([]); expect(live.queue.count).toBe(1000); expect(f.compatibilityReads()).toBe(4); expect(f.sourceReads()).toBe(4);
});
it('fails closed when the compatibility superset might be truncated', async () => {
  const f = fixture(); f.rows.splice(0, f.rows.length, f.first); f.blocks.splice(0, f.blocks.length, ...Array.from({ length: COMPATIBILITY_BATCH_LIMIT }, () => ({ winget_id: f.first.winget_id, version: f.first.version, architecture: f.first.architecture, installer_sha256: f.first.installer_sha256 })));
  mocks.client.mockReturnValue(f.client); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect((await getQaLiveSnapshot()).queue.next).toEqual([]); warn.mockRestore();
});
