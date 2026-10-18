import { enrichCustomerQaStatus } from './customer-qa-status';
import type { PackagingJob } from '@/lib/db/types';
const { state, from, holds, retries } = vi.hoisted(() => ({
  state: { configured: true, candidates: [] as Record<string, unknown>[], results: [] as Record<string, unknown>[], reputation: [] as Record<string, unknown>[], error: false },
  from: vi.fn(), holds: vi.fn(), retries: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ isSupabaseServerConfigured: () => state.configured, createServerClient: () => ({ from }) }));
vi.mock('@/lib/qa/installer-security-holds', () => ({ loadInstallerSecurityHolds: holds, installerSecurityReason: (n: number) => n ? 'VirusTotal: 1 engine flagged, rechecking daily' : 'VirusTotal: awaiting engine coverage, rechecking daily' }));
vi.mock('@/lib/qa/source-backoff', () => ({ qaSourceKey: (row: { id: string }) => row.id, qaSourceRetryAtMany: retries }));
const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const hash = 'a'.repeat(64), profile = 'b'.repeat(64);
const candidate = (patch = {}) => ({ id, winget_id: 'Example.App', version: '1.0', architecture: 'x64', installer_url: 'https://example.test/file.exe', installer_sha256: hash, package_profile_sha256: profile, status: 'queued', phase: null, next_retry_at: '-infinity', ...patch });
const job = (patch = {}) => ({ id: 'job1', status: 'awaiting_qa', qa_candidate_id: id, winget_id: 'Example.App', version: '1.0', architecture: 'x64', installer_sha256: hash, ...patch }) as PackagingJob;
beforeEach(() => {
  vi.clearAllMocks(); state.configured = true; state.error = false; state.candidates = [candidate()]; state.results = []; state.reputation = [];
  holds.mockResolvedValue(new Map()); retries.mockResolvedValue(new Map());
  from.mockImplementation((table: string) => {
    const q = { select: vi.fn(() => q), in: vi.fn(() => q), limit: vi.fn(() => q), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === 'qa_candidates' ? state.candidates : table === 'catalog_file_reputation' ? state.reputation : state.results, error: state.error ? { message: 'private engine RawEngine https://private.test?token=secret' } : null }).then(resolve) };
    return q;
  });
});
it('shows a real security hold and next check without returning internal evidence', async () => {
  holds.mockResolvedValue(new Map([[hash, { reason: 'VirusTotal: 1 engine flagged, rechecking daily', nextCheckAt: '2030-01-01T00:00:00Z', private: 'RawEngine' }]]));
  const [actual] = await enrichCustomerQaStatus([job()]);
  expect(actual.qa_status).toEqual({ category: 'installer_security_hold', message: expect.stringContaining('VirusTotal: 1 engine flagged'), nextEventAt: '2030-01-01T00:00:00.000Z' });
  expect(Object.keys(actual.qa_status!).sort()).toEqual(['category', 'message', 'nextEventAt']);
  expect(JSON.stringify(actual.qa_status)).not.toMatch(/RawEngine|[ab]{64}|private\.test|\u2013|\u2014/);
});
it('binds only authorized candidate ids and keeps similar jobs separate', async () => {
  state.candidates = [candidate(), candidate({ id: other, installer_sha256: 'c'.repeat(64) })];
  holds.mockResolvedValue(new Map([[hash, { reason: 'VirusTotal: awaiting engine coverage, rechecking daily', nextCheckAt: '2030-01-01' }]]));
  const rows = await enrichCustomerQaStatus([job(), job({ id: 'job2', qa_candidate_id: other, installer_sha256: 'c'.repeat(64) }), job({ id: 'done', status: 'deployed', qa_candidate_id: 'foreign' })]);
  expect(from.mock.results[0].value.in).toHaveBeenCalledWith('id', [id, other]);
  expect(rows[0].qa_status?.category).toBe('installer_security_hold'); expect(rows[1].qa_status?.category).toBe('queued'); expect(rows[2].qa_status).toBeUndefined();
});
it('uses source backoff and keeps security holds ahead of retry reasons', async () => {
  retries.mockResolvedValue(new Map([[id, '2030-02-01T00:00:00Z']]));
  expect((await enrichCustomerQaStatus([job()]))[0].qa_status).toMatchObject({ category: 'source_retry', nextEventAt: '2030-02-01T00:00:00.000Z' });
  holds.mockResolvedValue(new Map([[hash, { reason: 'VirusTotal: 1 engine flagged, rechecking daily', nextCheckAt: '2030-01-01' }]]));
  expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('installer_security_hold');
});
it('shows unknown reputation only for an exact published result tuple', async () => {
  state.results = [{ ...candidate(), tested_version: '1.0', virustotal_status: 'not_found', virustotal_malicious: 0, virustotal_suspicious: 0 }];
  expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('reputation_unknown');
  state.results[0].installer_sha256 = 'd'.repeat(64);
  expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('queued');
});
it('does not call a positive reputation result unknown', async () => {
  state.results = [{ ...candidate(), tested_version: '1.0', virustotal_status: 'flagged', virustotal_malicious: 1 }];
  expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('installer_security_hold');
});
it.each(['pending', 'not_found', 'error'])('ignores retired cache status %s when displaying current validation activity', async cacheStatus => {
  state.reputation = [{ sha256: hash, status: cacheStatus, malicious: null, suspicious: null, error: 'RawEngine secret' }];
  for (const [status, category] of [['running', 'testing'], ['queued', 'queued']]) {
    state.candidates = [candidate({ status })];
    const actual = (await enrichCustomerQaStatus([job()]))[0].qa_status;
    expect(actual?.category).toBe(category); expect(actual?.nextEventAt).toBeNull(); expect(JSON.stringify(actual)).not.toContain('RawEngine');
  }
});
it.each([{ winget_id: 'Other.App' }, { version: '2.0' }, { architecture: 'arm64' }, { installer_sha256: 'f'.repeat(64) }])('rejects stale or mismatched candidate evidence %j', async patch => {
  state.candidates = [candidate(patch)]; expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('unavailable');
});
it('distinguishes active testing and pending publication', async () => {
  state.candidates = [candidate({ status: 'running' })]; expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('testing');
  state.candidates = [candidate({ status: 'error', phase: 'publishing' })]; expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('publication');
});
it('keeps jobs usable when evidence fails or QA is not configured', async () => {
  state.error = true; expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('unavailable');
  state.configured = false; from.mockClear(); expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('unavailable'); expect(from).not.toHaveBeenCalled();
});
it('does not query for completed jobs or invalid candidate ids', async () => {
  const done = job({ status: 'deployed' }); expect(await enrichCustomerQaStatus([done])).toEqual([done]);
  expect((await enrichCustomerQaStatus([job({ qa_candidate_id: 'untrusted' })]))[0].qa_status?.category).toBe('unavailable'); expect(from).not.toHaveBeenCalled();
});
