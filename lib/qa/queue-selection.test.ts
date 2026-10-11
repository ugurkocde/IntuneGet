import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: vi.fn(), dispatch: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ createServerClient: mocks.client }));
vi.mock('@/lib/qa/dispatch', () => ({ dispatchQaCandidate: mocks.dispatch }));
vi.mock('@/lib/qa/curated-queue', () => ({ dispatchCuratedQueue: async () => ({ handled: false }) }));
vi.mock('@/lib/qa/live-session-data', () => ({ loadQaLiveCuratedSnapshot: async () => null }));
vi.mock('@/lib/qa/github-actions-health', () => ({ getGitHubActionsHealth: async () => ({ operational: true }) }));
vi.mock('@/lib/qa/github-actions-waiting-runs', () => ({ cancelStaleWaitingQaRuns: async () => [] }));
vi.mock('@/lib/qa/github-actions-run-status', () => ({ isQaWorkflowRunCompleted: async () => false }));
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
  let compatibilityReads = 0;
  const client = {
    rpc: vi.fn(async (_name: string, args: { p_id: string }) => { claimed.push(args.p_id); return { data: { row: rows.find(r => r.id === args.p_id) }, error: null }; }),
    from(table: string) {
      if (table === 'qa_package_blocks') compatibilityReads++;
      let count = false, cap = Infinity;
      const filters: Array<(r: Record<string, unknown>) => boolean> = [], sort: Array<[string, boolean]> = [];
      const result = () => {
        let data: Array<Record<string, unknown>> = table === 'qa_candidates' ? rows : table === 'qa_pipeline_control' ? [{ id: 'global', paused: false }] : table === 'qa_source_backoff' ? [{ source_key: qaSourceKey(source), next_retry_at: '2099-01-02T00:00:00Z' }] : table === 'qa_package_blocks' ? [{ winget_id: held.winget_id, version: held.version, architecture: held.architecture, installer_sha256: held.installer_sha256, block_code: 'failed_managed_lifecycle', detail: 'reviewed tuple' }] : [];
        data = data.filter(r => filters.every(f => f(r)));
        data.sort((a, b) => { for (const [key, ascending] of sort) { const x = a[key] as string | number, y = b[key] as string | number, cmp = x < y ? -1 : x > y ? 1 : 0; if (cmp) return ascending ? cmp : -cmp; } return 0; });
        return { data: data.slice(0, cap), count: count ? data.length : undefined, error: null };
      };
      const builder = {
        select(_columns: string, options?: { count?: string }) { count = !!options?.count; return builder; },
        eq(key: string, value: unknown) { filters.push(r => r[key] === value); return builder; },
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
  return { client, claimed, first, deferred, source, rows, compatibilityReads: () => compatibilityReads };
}
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
  expect((await getQaLiveSnapshot()).queue.next).toHaveLength(10); expect(f.compatibilityReads()).toBe(10);
});
