import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLICATION_FAILURE, recoveryKind, retryDelayMs, rateLimitUntil, publicationJob, recoverInfrastructure } from './recovery.mjs';
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
