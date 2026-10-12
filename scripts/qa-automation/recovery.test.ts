import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLICATION_FAILURE, recoveryKind, retryDelayMs, rateLimitUntil, publicationJob, recoverInfrastructure, recoverStalledPublication } from './recovery.mjs';
import { repairCompletion, runRepair } from './repair-process.mjs';

const c = { id: 'a', winget_id: 'Example.App', version: '1', architecture: 'x64', installer_sha256: 'A'.repeat(64),
  status: 'error', test_level: 'psadt-package', failure_summary: PUBLICATION_FAILURE, finished_at: '2026-09-22T00:00:00Z',
  github_run_id: '123', attempts: 2, recovery_attempts: 0, recovery_history: [] };
const now = Date.parse('2026-09-23T00:00:00Z');
function deps(candidate = c) {
  const rows = vi.fn(async (table: string, params: Record<string, string>) => table === 'qa_candidates' && params.status === 'eq.error' ? [candidate] : []);
  const patch = vi.fn(async () => [{ id: 'a' }]);
  const github = vi.fn(async (path: string) => {
    if (path.endsWith('/jobs/456/rerun')) return null;
    if (path.includes('/jobs?')) return { total_count: 2, jobs: [
      { name: 'qa', conclusion: 'success' }, { name: 'Publish compact app JSON', id: 456, status: 'completed', conclusion: 'failure' },
    ] };
    return { id: 123, event: 'workflow_dispatch', path: '.github/workflows/intune-qa.yml', head_branch: 'main', status: 'completed' };
  });
  return { rows, patch, github, now, requiredPin: 'f'.repeat(40) };
}
describe('durable infrastructure recovery', () => {
  function strandedPublisher() {
    const candidate = { ...c, status: 'running', phase: 'publishing' };
    const run = { id: 123, status: 'queued', path: '.github/workflows/intune-qa.yml', head_branch: 'main', event: 'workflow_dispatch' };
    const jobs = [{ name: 'qa', status: 'completed', conclusion: 'success' },
      { name: 'Publish compact app JSON', status: 'queued', conclusion: null, steps: [] }];
    const github = vi.fn(async (path: string) => path.includes('/jobs?') ? { total_count: jobs.length, jobs } : run);
    const patch = vi.fn(async () => [{ id: c.id }]);
    return { candidate, run, jobs, github, patch, now };
  }
  it('releases only a queued publisher and durably preserves the completed VM evidence', async () => {
    const d = strandedPublisher();
    expect(await recoverStalledPublication(d)).toMatchObject({ action: 'publication_cancel_requested' });
    expect(d.github).toHaveBeenLastCalledWith('/actions/runs/123/cancel', { method: 'POST', body: '{}' });
    expect(d.patch).toHaveBeenCalledWith('qa_candidates', expect.objectContaining({ github_run_id: 'eq.123', status: 'eq.running' }),
      expect.objectContaining({ recovery_history: [expect.objectContaining({ kind: 'publication_queue_cancel', previousRunId: '123' })] }));
    expect(d.patch.mock.calls[0][2]).not.toHaveProperty('github_run_id');
    expect(d.patch.mock.calls[0][2]).not.toHaveProperty('status');
  });
  it('never cancels a publisher that started or a lifecycle without complete job evidence', async () => {
    const d = strandedPublisher(); d.jobs[1].status = 'in_progress';
    expect(await recoverStalledPublication(d)).toBeNull();
    expect(d.patch).not.toHaveBeenCalled();
    d.jobs[1].status = 'queued'; d.jobs[0].status = 'in_progress';
    expect(await recoverStalledPublication(d)).toBeNull();
    expect(d.github.mock.calls.some(([path]) => path.endsWith('/cancel'))).toBe(false);
  });
  it('does not cancel after losing the candidate claim', async () => {
    const d = strandedPublisher(); d.patch.mockResolvedValue([]);
    expect(await recoverStalledPublication(d)).toMatchObject({ action: 'recovery_claim_lost' });
    expect(d.github.mock.calls.some(([path]) => path.endsWith('/cancel'))).toBe(false);
  });
  it('converts confirmed cancellation to publication recovery, never to a VM rerun', async () => {
    const d = strandedPublisher(); d.run.status = 'completed';
    d.jobs[1].status = 'waiting'; d.jobs[1].conclusion = 'cancelled' as never;
    expect(await recoverStalledPublication(d)).toMatchObject({ action: 'publication_failure_recorded' });
    expect(d.patch).toHaveBeenCalledWith('qa_candidates', expect.anything(), expect.objectContaining({
      status: 'error', failure_summary: PUBLICATION_FAILURE,
    }));
    expect(d.github.mock.calls.some(([path]) => path.endsWith('/cancel'))).toBe(false);
  });
  it('waits briefly after cancellation, then escalates instead of looping forever', async () => {
    const d = strandedPublisher();
    d.candidate.recovery_history = [{ kind: 'publication_queue_cancel', previousRunId: '123', at: new Date(now - 60_000).toISOString() }] as never;
    expect(await recoverStalledPublication(d)).toMatchObject({ action: 'publication_cancel_waiting' });
    expect(await recoverStalledPublication({ ...d, now: now + 5 * 60_000 })).toMatchObject({ repairRequired: true });
    expect(d.patch).not.toHaveBeenCalled();
  });
  it('recovers unstarted dispatch timeouts without reclassifying real installer failures', async () => {
    for (const failure_summary of ['The QA workflow did not start before the dispatch timeout.',
      'The installation test did not finish before the safety timeout.']) {
      const candidate = { ...c, failure_summary, started_at: null, github_run_id: null };
      expect(recoveryKind(candidate)).toBe('dispatch');
      expect(await recoverInfrastructure({ ...deps(candidate as never), dryRun: true }))
        .toMatchObject({ action: 'would_recover_infrastructure', kind: 'dispatch' });
      expect(recoveryKind({ ...candidate, started_at: '2026-09-22T00:00:00Z' })).toBeNull();
      expect(recoveryKind({ ...candidate, github_run_id: '123' })).toBeNull();
      expect(recoveryKind({ ...candidate, started_at: undefined })).toBeNull();
    }
  });
  it('reruns only the publishing job after a successful VM test', async () => {
    const d = deps();
    expect(await recoverInfrastructure(d)).toMatchObject({ action: 'publication_retry_started' });
    expect(d.github).toHaveBeenLastCalledWith('/actions/jobs/456/rerun', { method: 'POST', body: '{}' });
    expect(d.patch).toHaveBeenCalledWith('qa_candidates', expect.objectContaining({ status: 'eq.error', recovery_attempts: 'eq.0' }),
      expect.objectContaining({ status: 'running', phase: 'publishing', recovery_attempts: 1, recovery_history: [expect.objectContaining({ previousRunId: '123' })] }));
  });
  it('never launches a job after losing the database claim', async () => {
    const d = deps(); d.patch.mockResolvedValue([]);
    expect(await recoverInfrastructure(d)).toMatchObject({ action: 'recovery_claim_lost' });
    expect(d.github.mock.calls.some(([path]) => path.endsWith('/rerun'))).toBe(false);
  });
  it('keeps the active lease when the rerun response is lost', async () => {
    const d = deps(); const original = d.github.getMockImplementation()!;
    d.github.mockImplementation(async path => { if (path.endsWith('/rerun')) throw new Error('network timeout'); return original(path); });
    await expect(recoverInfrastructure(d)).rejects.toThrow('network timeout');
    expect(d.patch).toHaveBeenCalledTimes(1);
  });
  it('does not mutate production in a dry run or retry lifecycle/security failures', async () => {
    const d = deps(); await recoverInfrastructure({ ...d, dryRun: true });
    expect(d.patch).not.toHaveBeenCalled(); expect(d.github).not.toHaveBeenCalled();
    expect(recoveryKind({ ...c, status: 'failed' })).toBeNull();
    expect(recoveryKind({ ...c, failure_summary: 'VirusTotal blocked the exact installer.' })).toBeNull();
  });
  it('preserves security blocks without starting a workflow', async () => {
    const d = deps(); d.rows.mockImplementation(async (table, params) => table === 'qa_candidates' && params.status === 'eq.error' ? [c] : table === 'qa_package_blocks' ? [{ winget_id: c.winget_id }] as never : []);
    expect(await recoverInfrastructure(d)).toMatchObject({ action: 'no_recovery_due' });
    expect(d.github).not.toHaveBeenCalled();
    expect(d.patch).toHaveBeenCalledWith('qa_candidates', expect.anything(), expect.objectContaining({ status: 'superseded' }));
  });
  it('never republishes stale catalog evidence over a newer result of the same version', async () => {
    const candidate = { ...c, test_config: { profileKind: 'catalog-default' } };
    const d = deps(candidate);
    d.rows.mockImplementation(async (table, params) => table === 'qa_candidates' && params.status === 'eq.error' ? [candidate]
      : table === 'qa_results' ? [{ tested_version: c.version, tested_at_utc: new Date(now).toISOString() }] as never : []);
    expect(await recoverInfrastructure(d)).toMatchObject({ action: 'no_recovery_due' });
    expect(d.github).not.toHaveBeenCalled();
    expect(d.patch).toHaveBeenCalledWith('qa_candidates', expect.anything(), expect.objectContaining({ status: 'superseded' }));
  });
  it('escalates an exhausted retry budget and rejects an untrusted workflow', async () => {
    expect(await recoverInfrastructure(deps({ ...c, recovery_attempts: 5 }))).toMatchObject({ action: 'recovery_exhausted', repairRequired: true });
    await expect(publicationJob('123', async () => ({ id: 123, event: 'push', path: 'wrong.yml' }))).rejects.toThrow('identity mismatch');
  });
  it('rejects empty successful GET responses as incomplete evidence', async () => {
    await expect(publicationJob('123', async () => null)).rejects.toThrow('Incomplete QA workflow evidence');
    await expect(publicationJob('123', async path => path.includes('/jobs?') ? null : {
      id: 123, event: 'workflow_dispatch', path: '.github/workflows/intune-qa.yml', head_branch: 'main', status: 'completed',
    })).rejects.toThrow('Incomplete QA job evidence');
  });
  it('uses a fresh lifecycle for legacy post-merge failures, but permits idempotent publishers', async () => {
    const run = { id: 123, event: 'workflow_dispatch', path: '.github/workflows/intune-qa.yml', head_branch: 'main', status: 'completed' };
    const steps = [{ name: 'Merge result through protected branch', conclusion: 'success' }];
    const github = async (path: string) => path.includes('/jobs?') ? { total_count: 2, jobs: [
      { name: 'qa', conclusion: 'success' },
      { name: 'Publish compact app JSON', id: 456, status: 'completed', conclusion: 'failure', steps },
    ] } : run;
    expect(await publicationJob('123', github)).toEqual({ lifecycleRequired: true });
    steps.push({ name: 'Commit or reuse the compact result', conclusion: 'success' });
    expect(await publicationJob('123', github)).toEqual({ jobId: 456 });
  });
  it('honors GitHub reset/Retry-After headers and caps exponential delays', () => {
    const response = new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((now + 3600000) / 1000) } });
    expect(Date.parse(rateLimitUntil(response, now))).toBe(now + 3605000);
    expect(rateLimitUntil(new Response('', { status: 403 }), now)).toBeNull();
    expect(retryDelayMs(10)).toBe(24 * 60 * 60 * 1000);
  });
  it('requires a completed CLI turn and final report, even with exit zero', () => {
    expect(repairCompletion(0, null, true, 'Verified')).toBe('completed');
    expect(repairCompletion(0, null, false, '')).toBe('incomplete');
    expect(repairCompletion(1, null, true, 'Partial')).toBe('failed');
    expect(repairCompletion(null, 'SIGTERM', false, '')).toBe('terminated');
  });
  it.each(['complete', 'partial'])('persists real child-process completion and heartbeat: %s', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'intuneget-repair-test-'));
    try {
      mkdirSync(join(root, 'logs'));
      writeFileSync(join(root, 'repair-request.md'), mode);
      const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repair-cli.mjs');
      expect(await runRepair(root, root, fixture, process.pid)).toBe(mode === 'complete' ? 0 : 1);
      const state = JSON.parse(readFileSync(join(root, 'repair-run.json'), 'utf8'));
      expect(state).toMatchObject({ status: mode === 'complete' ? 'completed' : 'incomplete', threadId: 'test-thread' });
      expect(state.agentPid).toBeGreaterThan(0);
      expect(Number.isFinite(Date.parse(state.lastEventAtUtc))).toBe(true);
      expect(Number.isFinite(Date.parse(state.finishedAtUtc))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
