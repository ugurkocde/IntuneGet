import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { qaSourceKey } from '@/lib/qa/source-backoff';
import { createInstallerHealthKey } from '@/lib/installer-preflight';
import { holdCustomerUpstreamJob, reopenCustomerUpstreamJobs } from './customer-upstream-recovery';

const { holds, reconcile } = vi.hoisted(() => ({ holds: vi.fn(), reconcile: vi.fn() }));
vi.mock('@/lib/qa/installer-security-holds', () => ({ loadInstallerSecurityHolds: holds }));
vi.mock('@/lib/catalog-installer-reconciliation', () => ({ reconcileCatalogInstaller: reconcile }));
const digest = 'A'.repeat(64), candidateId = '10000000-0000-4000-8000-000000000001';
const item = { wingetId: 'Example.App', version: '1.0', architecture: 'x64', installerUrl: 'https://example.test/a.exe', installerSha256: digest, installerType: 'exe', installScope: 'machine', installCommand: '/S', uninstallCommand: '/U' } as const;
type Row = Record<string, unknown>;
let rows: Record<string, Row[]>;
let calls: Array<{ table: string; patch: Row }>;
let errors: Set<string>;
let beforeWrite: (() => void) | undefined;
function client(): SupabaseClient<Database> {
  return { from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | undefined, limit = Infinity;
    const order: string[] = [];
    const q = {
      select: () => q, order: (key: string) => { order.push(key); return q; },
      ilike: (key: string, value: string) => { filters.push(row => String(row[key]).toLowerCase() === value.toLowerCase()); return q; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
      is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return q; },
      lte: (key: string, value: string) => { filters.push(row => Date.parse(String(row[key])) <= Date.parse(value)); return q; },
      or: () => { filters.push(row => Number(row.virustotal_malicious) > 0 || Number(row.virustotal_suspicious) > 0); return q; },
      limit: (value: number) => { limit = value; return q; },
      update: (value: Row) => { patch = value; return q; },
      run: () => {
        if (errors.has(table)) return { data: null, error: { message: 'private failure' } };
        if (patch && beforeWrite) { const hook = beforeWrite; beforeWrite = undefined; hook(); }
        const selected = (rows[table] || []).filter(row => filters.every(f => f(row)))
          .sort((a, b) => { for (const key of order) { const n = String(a[key]).localeCompare(String(b[key])); if (n) return n; } return 0; }).slice(0, limit);
        if (patch) for (const row of selected) { calls.push({ table, patch }); Object.assign(row, structuredClone(patch), { updated_at: new Date().toISOString() }); }
        return { data: structuredClone(selected), error: null };
      },
      maybeSingle: async () => { const result = q.run(); return { ...result, data: result.data?.[0] || null }; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(q.run()).then(resolve),
    };
    return q;
  } } as unknown as SupabaseClient<Database>;
}
const job = () => rows.packaging_jobs[0] as unknown as Database['public']['Tables']['packaging_jobs']['Row'];
beforeEach(() => {
  vi.clearAllMocks(); calls = []; errors = new Set(); beforeWrite = undefined;
  holds.mockResolvedValue(new Map()); reconcile.mockResolvedValue({ item: { ...item }, trustedInstallers: [] });
  rows = {
    packaging_jobs: [{ id: 'job', status: 'awaiting_qa', updated_at: '2026-01-01T00:00:00Z', qa_resume_due_at: '2026-01-01T00:00:00Z', qa_candidate_id: candidateId, winget_id: item.wingetId, version: item.version, architecture: item.architecture, installer_url: item.installerUrl, installer_sha256: digest, package_config: { ...item }, github_run_id: null, intune_app_id: null, archived_at: null, cancelled_at: null }],
    qa_candidates: [{ id: candidateId, winget_id: item.wingetId, version: item.version, architecture: item.architecture, installer_url: item.installerUrl, installer_sha256: digest, status: 'queued', phase: null }],
    qa_source_backoff: [{ source_key: qaSourceKey({ winget_id: item.wingetId, version: item.version, architecture: item.architecture, installer_url: item.installerUrl, installer_sha256: digest }), failure_count: 7, next_retry_at: '2030-01-01T00:00:00Z' }],
    installer_health: [], qa_package_results: [], qa_winget_poll_state: [{ id: 'microsoft/winget-pkgs', head_sha: 'a'.repeat(40) }],
  };
});
it('persists a source block with an allowlisted code and no QA mutations', async () => {
  expect(await holdCustomerUpstreamJob(client(), structuredClone(job()))).toBe(true);
  expect(job()).toMatchObject({ status: 'blocked_upstream', error_code: 'UPSTREAM_SOURCE_BACKOFF', version: '1.0', qa_candidate_id: candidateId });
  expect(job().status_message).not.toMatch(/404|24|https?:|[a-f0-9]{64}/i);
  expect(calls.every(call => call.table === 'packaging_jobs')).toBe(true);
});
it.each([0, 1, 6])('does not turn ordinary backoff count %i into an upstream block', async failure_count => {
  rows.qa_source_backoff[0].failure_count = failure_count;
  expect(await holdCustomerUpstreamJob(client(), job())).toBe(false); expect(calls).toEqual([]);
});
it('does not hold an expired source block', async () => {
  rows.qa_source_backoff[0].next_retry_at = '2000-01-01T00:00:00Z';
  expect(await holdCustomerUpstreamJob(client(), job())).toBe(false);
});
it.each(['winget_id', 'version', 'architecture', 'installer_url', 'installer_sha256'])('ignores a candidate with mismatching %s', async field => {
  rows.qa_candidates[0][field] = 'other'; expect(await holdCustomerUpstreamJob(client(), job())).toBe(false); expect(calls).toEqual([]);
});
it.each(['running', 'dispatched', 'passed'])('does not mask active or passed QA: %s', async status => {
  rows.qa_candidates[0].status = status; expect(await holdCustomerUpstreamJob(client(), job())).toBe(false);
});
it('keeps publication recovery ahead of an old source block', async () => {
  Object.assign(rows.qa_candidates[0], { status: 'error', phase: 'publishing' });
  expect(await holdCustomerUpstreamJob(client(), job())).toBe(false);
});
it('consumes a recorded exact metadata mismatch, never its arbitrary text', async () => {
  rows.qa_source_backoff = [];
  rows.installer_health = [{ cache_key: createInstallerHealthKey(item), status: 'error', reason_code: 'MANIFEST_CHANGED', reason_message: 'private secret', expires_at: '2030-01-01T00:00:00Z' }];
  expect(await holdCustomerUpstreamJob(client(), job())).toBe(true);
  expect(job().error_code).toBe('UPSTREAM_METADATA_MISMATCH'); expect(job().status_message).not.toContain('private');
});
it.each(['quarantine', 'security hold', 'positive result'])('preserves priority of %s', async kind => {
  if (kind === 'quarantine') rows.installer_health = [{ cache_key: createInstallerHealthKey(item), status: 'quarantined', reason_code: 'HASH_MISMATCH' }];
  if (kind === 'security hold') holds.mockResolvedValue(new Map([[digest.toLowerCase(), {}]]));
  if (kind === 'positive result') rows.qa_package_results = [{ winget_id: item.wingetId, tested_version: item.version, architecture: item.architecture, installer_sha256: digest, virustotal_malicious: 1 }];
  expect(await holdCustomerUpstreamJob(client(), job())).toBe(false); expect(calls).toEqual([]);
});
it('never overwrites a concurrent cancellation or configuration change', async () => {
  const snapshot = structuredClone(job()); beforeWrite = () => Object.assign(job(), { status: 'cancelled', updated_at: '2030-01-01T00:00:00Z' });
  expect(await holdCustomerUpstreamJob(client(), snapshot)).toBe(true); expect(job().status).toBe('cancelled'); expect(calls).toEqual([]);
});
it('fails closed when required evidence is unavailable', async () => {
  errors.add('qa_source_backoff'); await expect(holdCustomerUpstreamJob(client(), job())).rejects.toThrow(); expect(calls).toEqual([]);
});
async function block() {
  await holdCustomerUpstreamJob(client(), structuredClone(job()));
  rows.packaging_jobs[0].qa_resume_due_at = '2000-01-01T00:00:00Z'; calls = [];
}
it('does not re-read a manifest while the existing feed head is unchanged', async () => {
  await block(); expect(await reopenCustomerUpstreamJobs(client())).toBe(0); expect(reconcile).not.toHaveBeenCalled();
});
it('requeues a changed exact-version manifest through normal QA without switching versions or dispatching', async () => {
  await block(); rows.qa_winget_poll_state[0].head_sha = 'b'.repeat(40);
  reconcile.mockResolvedValue({ item: { ...item, installerUrl: 'https://example.test/fixed.exe', installerSha256: 'B'.repeat(64) } });
  expect(await reopenCustomerUpstreamJobs(client())).toBe(1);
  expect(reconcile).toHaveBeenCalledWith(item);
  expect(job()).toMatchObject({ status: 'awaiting_qa', version: '1.0', qa_candidate_id: null, github_run_id: null, intune_app_id: null, package_config: item });
  expect(calls.every(call => call.table === 'packaging_jobs')).toBe(true);
});
it('keeps an unrelated manifest change blocked and advances only its customer baseline', async () => {
  await block(); rows.qa_winget_poll_state[0].head_sha = 'b'.repeat(40);
  expect(await reopenCustomerUpstreamJobs(client())).toBe(0); expect(job().status).toBe('blocked_upstream');
  expect(job().error_details).toMatchObject({ upstreamManifestSha: 'b'.repeat(40) });
});
it('never accepts a different version from reconciliation', async () => {
  await block(); rows.qa_winget_poll_state[0].head_sha = 'b'.repeat(40); reconcile.mockResolvedValue({ item: { ...item, version: '2.0' } });
  expect(await reopenCustomerUpstreamJobs(client())).toBe(0); expect(job().status).toBe('blocked_upstream');
  expect(Date.parse(job().qa_resume_due_at)).toBeGreaterThan(Date.now());
});
it('retains the old baseline and job when a manifest lookup fails', async () => {
  await block(); rows.qa_winget_poll_state[0].head_sha = 'b'.repeat(40); reconcile.mockRejectedValue(new Error('private'));
  expect(await reopenCustomerUpstreamJobs(client())).toBe(0); expect(job().status).toBe('blocked_upstream');
  expect(job().error_details).toMatchObject({ upstreamManifestSha: 'a'.repeat(40) });
  expect(Date.parse(job().qa_resume_due_at)).toBeGreaterThan(Date.now());
});
it('can recheck through normal gates after the recorded cooldown even if the feed stalls', async () => {
  await block(); (job().error_details as Record<string, unknown>).upstreamRetryAt = '2000-01-01T00:00:00Z';
  expect(await reopenCustomerUpstreamJobs(client())).toBe(1); expect(job().status).toBe('awaiting_qa');
});
it('returns an expired upstream block to normal QA even if its selected manifest remains unavailable', async () => {
  await block(); (job().error_details as Record<string, unknown>).upstreamRetryAt = '2000-01-01T00:00:00Z';
  reconcile.mockRejectedValue(new Error('MANIFEST_UNAVAILABLE'));
  expect(await reopenCustomerUpstreamJobs(client())).toBe(1);
  expect(job()).toMatchObject({ status: 'awaiting_qa', version: '1.0', qa_candidate_id: null, github_run_id: null, intune_app_id: null });
});
it('does not reopen a concurrently cancelled job', async () => {
  await block(); rows.qa_winget_poll_state[0].head_sha = 'b'.repeat(40);
  reconcile.mockResolvedValue({ item: { ...item, installerUrl: 'https://example.test/fixed.exe' } });
  beforeWrite = () => Object.assign(job(), { status: 'cancelled' });
  expect(await reopenCustomerUpstreamJobs(client())).toBe(0); expect(job().status).toBe('cancelled');
});

it('moves ten unavailable manifests out of the way so the eleventh job can resume', async () => {
  await block(); const template = structuredClone(rows.packaging_jobs[0]);
  rows.packaging_jobs = Array.from({ length: 11 }, (_, i) => ({ ...structuredClone(template),
    id: 'job' + String(i).padStart(2, '0'), package_config: { ...item, displayName: i === 10 ? 'last' : 'unavailable' },
  }));
  rows.qa_winget_poll_state[0].head_sha = 'b'.repeat(40);
  reconcile.mockImplementation(async input => {
    if (input.displayName !== 'last') throw new Error('MANIFEST_UNAVAILABLE');
    return { item: { ...input, installerUrl: 'https://example.test/fixed.exe' } };
  });
  expect(await reopenCustomerUpstreamJobs(client())).toBe(0);
  expect(rows.packaging_jobs.slice(0, 10).every(row => Date.parse(String(row.qa_resume_due_at)) > Date.now())).toBe(true);
  expect(await reopenCustomerUpstreamJobs(client())).toBe(1);
  expect(rows.packaging_jobs[10].status).toBe('awaiting_qa');
});

it.each(['unknown code', 'configuration mismatch'])('reschedules skipped rows: %s', async kind => {
  await block();
  if (kind === 'unknown code') rows.packaging_jobs[0].error_code = 'UNKNOWN';
  else rows.packaging_jobs[0].package_config = { ...item, version: '2.0' };
  expect(await reopenCustomerUpstreamJobs(client())).toBe(0);
  expect(job().status).toBe('blocked_upstream');
  expect(Date.parse(job().qa_resume_due_at)).toBeGreaterThan(Date.now());
});
it('recognizes a lowercase stored security hash without reclassifying it as upstream', async () => {
  rows.qa_package_results = [{ winget_id: item.wingetId, tested_version: item.version, architecture: item.architecture, installer_sha256: digest.toLowerCase(), virustotal_malicious: 1 }];
  expect(await holdCustomerUpstreamJob(client(), job())).toBe(false); expect(calls).toEqual([]);
});
it.each(['version', 'wingetId', 'installerUrl', 'installerSha256', 'architecture'])('does not classify a divergent customer configuration: %s', async field => {
  rows.packaging_jobs[0].package_config = { ...item, [field]: 'other' };
  expect(await holdCustomerUpstreamJob(client(), job())).toBe(false); expect(calls).toEqual([]);
});
it('honors the route work deadline before starting another manifest read', async () => {
  await block(); rows.qa_winget_poll_state[0].head_sha = 'b'.repeat(40);
  expect(await reopenCustomerUpstreamJobs(client(), Date.now() - 1)).toBe(0);
  expect(reconcile).not.toHaveBeenCalled(); expect(calls).toEqual([]);
});
