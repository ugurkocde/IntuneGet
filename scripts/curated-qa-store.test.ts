import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
import { buildCuratedCartItem } from '@/lib/curated-catalog/package';
import { releaseFixture } from '@/lib/curated-catalog/test-fixtures';

type Store = typeof import('./curated-qa-store.mjs');
let store: Store;
const calls: Array<{ method: string; path: string; body: unknown }> = [];
let responses: Record<string, unknown> = {};

beforeAll(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://supabase.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace('https://supabase.test/rest/v1/', '');
    calls.push({ method: init.method || 'GET', path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(responses).find(prefix => path.startsWith(prefix));
    return new Response(key ? JSON.stringify(responses[key]) : '', { status: 200 });
  }));
  store = await import('./curated-qa-store.mjs');
});
afterEach(() => { calls.length = 0; responses = {}; });

const app = CURATED_APPS.find(item => item.id === 'vscode')!;
const release = releaseFixture(app, '1.140.0');
const report = (overrides: Record<string, unknown> = {}) => ({
  status: 'passed', vmRestored: true, verifiedAt: '2026-10-05T08:00:00Z', candidate: release.candidate, previous: null,
  provenance: { workflowCommit: '1'.repeat(40), websiteCommit: '2'.repeat(40), runId: '42' },
  inspection: { current: { installerSha256: release.installerSha256, signature: { status: 'valid', publisher: 'Microsoft Corporation' }, security: { status: 'clean', signatureVersion: '1.2' } } },
  profile: { psadtConfigSha256: 'c'.repeat(64), executionProfileSha256: 'D'.repeat(64), packagerCommit: '3'.repeat(40),
    workflowInput: { silentSwitches: '/VERYSILENT', uninstallCommand: 'REGISTRY_UNINSTALL_KEY:x:y', detectionRules: '[{"type":"registry"}]', psadtConfig: '{"deployMode":"Silent"}' } },
  qa: { testedAt: '2026-10-05T08:10:00Z', packagerCommit: '3'.repeat(40), phases: { install: { passed: true }, uninstall: { passed: true } }, upgrade: { tested: false } },
  ...overrides,
});
const run = (id: number, title: string, extra: Record<string, unknown> = {}) => ({ id, run_attempt: 1, status: 'completed', conclusion: 'success', display_title: title, html_url: `https://github.test/runs/${id}`, updated_at: '2026-10-05T08:20:00Z', head_sha: '1'.repeat(40), ...extra });

describe('curated QA history', () => {
  it('maps a run to a qa_results shaped row with commands, detection and outcome', () => {
    const row = store.historyRow(run(42, `VS Code 1.140.0 x64 [${release.candidate.id}]`), report(), { apps: CURATED_APPS, buildCuratedCartItem })!;
    expect(row).toMatchObject({ kind: 'release', outcome: 'Passed', winget_id: app.packageId, uninstall_command: 'REGISTRY_UNINSTALL_KEY:x:y', silent_args: '/VERYSILENT',
      detection: [{ type: 'registry' }], psadt_config: { deployMode: 'Silent' }, signer: 'Microsoft Corporation', upgrade_tested: false });
    expect(row.install_command).toContain('/VERYSILENT');
  });

  it('records failures with their bounded diagnosis', () => {
    const failed = store.historyRow(run(43, `VS Code 1.140.0 x64 [${release.candidate.id}]`, { conclusion: 'failure' }),
      report({ status: 'failed', failedStep: 'cleanInstall', failedMessage: 'exit code (60001)', failedLifecycle: 'x'.repeat(900) }), { apps: CURATED_APPS, buildCuratedCartItem })!;
    expect(failed).toMatchObject({ outcome: 'Failed', failed_step: 'cleanInstall', failed_message: 'exit code (60001)' });
    expect(failed.failed_lifecycle).toHaveLength(600);
  });

  it('stores only runs that are not recorded yet', async () => {
    responses = { 'curated_qa_runs?select': [{ github_run_id: '42', github_run_attempt: 1 }] };
    const runs = [run(42, `A [${release.candidate.id}]`), run(43, `B [${release.candidate.id}]`), run(44, 'unrelated title')];
    const count = await store.syncHistory(runs, async () => ({ report: report() }), { apps: CURATED_APPS, buildCuratedCartItem });
    expect(count).toBe(1);
    const post = calls.find(call => call.method === 'POST')!;
    expect((post.body as Array<{ github_run_id: string }>).map(row => row.github_run_id)).toEqual(['43']);
  });
});

describe('custom configuration verification lifecycle', () => {
  const now = new Date('2026-10-05T09:00:00Z');
  const row = (overrides: Record<string, unknown>) => ({ id: '11111111-2222-4333-8444-555555555555', release_id: release.id, app_id: app.id, winget_id: app.packageId,
    psadt_config_sha256: 'c'.repeat(64), psadt_config: { deployMode: 'Silent' }, status: 'requested', github_run_id: null, failure_detail: null, updated_at: '2026-10-05T08:00:00Z', ...overrides });
  const base = { releases: [release], apps: CURATED_APPS, now, authenticate: async () => {}, slots: 1 };

  it('keeps a persisted request queued until the minute dispatcher actually starts it', async () => {
    responses = { 'curated_config_verifications?select': [row({})] };
    const dispatch = vi.fn(async () => ({ queued: true }));
    await store.processConfigVerifications({ ...base, runs: [], readEvidence: async () => { throw new Error('none'); }, dispatch });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(calls.some(call => call.method === 'PATCH')).toBe(false);
  });

  it('supersedes only older queued release identities without resetting duplicate intent', async () => {
    responses = { 'curated_verification_queue?select': [
      { id: 'old', version: '1.139.0', verification_key: 'release:old' },
      { id: 'same', version: '1.140.0', verification_key: `release:${release.candidate.id}` },
      { id: 'same-version-other-installer', version: '1.140.0', verification_key: 'release:other-installer' },
    ] };
    await store.enqueueCuratedVerification({ candidate: JSON.stringify(release.candidate), app_label: `VS Code [${release.candidate.id}]` });
    expect(calls.find(call => call.path === 'rpc/enqueue_curated_verification')?.body).toMatchObject({
      p_app_id: app.id, p_kind: 'release', p_supersede_ids: ['old'],
    });
  });

  it('does not enqueue a stale discovery behind an already newer queued release', async () => {
    responses = { 'curated_verification_queue?select': [{ id: 'newer', version: '1.141.0', verification_key: 'release:newer' }] };
    await store.enqueueCuratedVerification({ candidate: JSON.stringify(release.candidate), app_label: `VS Code [${release.candidate.id}]` });
    expect(calls.some(call => call.method === 'POST')).toBe(false);
  });

  it('dispatches a requested configuration with its PSADT settings and marks it verifying', async () => {
    responses = { 'curated_config_verifications?select': [row({})] };
    const dispatch = vi.fn();
    const result = await store.processConfigVerifications({ ...base, runs: [], readEvidence: async () => { throw new Error('none'); }, dispatch });
    expect(result.dispatched).toBe(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ psadt_config: '{"deployMode":"Silent"}', app_label: expect.stringMatching(/\[config:11111111-2222-4333-8444-555555555555\]$/) });
    expect(calls.find(call => call.method === 'PATCH')?.body).toMatchObject({ status: 'verifying' });
  });

  it('records a pass only for the exact release and configuration', async () => {
    const title = `VS Code custom settings [config:11111111-2222-4333-8444-555555555555]`;
    responses = { 'curated_config_verifications?select': [row({ status: 'verifying' })] };
    await store.processConfigVerifications({ ...base, runs: [run(50, title)], readEvidence: async () => ({ report: report() }), dispatch: vi.fn() });
    expect(calls.find(call => call.method === 'PATCH')?.body).toMatchObject({ status: 'passed', execution_profile_sha256: 'd'.repeat(64), github_run_id: '50' });

    calls.length = 0;
    await store.processConfigVerifications({ ...base, runs: [run(51, title)], readEvidence: async () => ({ report: report({ profile: { ...report().profile, psadtConfigSha256: 'e'.repeat(64) } }) }), dispatch: vi.fn() });
    expect(calls.find(call => call.method === 'PATCH')?.body).toMatchObject({ status: 'failed' });
  });

  it('fails a configuration on a lifecycle failure but retries infrastructure failures', async () => {
    const title = `X [config:11111111-2222-4333-8444-555555555555]`;
    responses = { 'curated_config_verifications?select': [row({ status: 'verifying' })] };
    await store.processConfigVerifications({ ...base, runs: [run(60, title, { conclusion: 'failure' })], readEvidence: async () => ({ report: report({ status: 'failed', failedStep: 'cleanUninstall', failedMessage: 'exit code (1603)' }) }), dispatch: vi.fn() });
    expect(calls.find(call => call.method === 'PATCH')?.body).toMatchObject({ status: 'failed', failure_detail: expect.stringContaining('1603') });
    calls.length = 0;
    await store.processConfigVerifications({ ...base, runs: [run(61, title, { conclusion: 'failure' })], readEvidence: async () => ({ report: report({ status: 'failed', failedStep: 'defenderStatus' }) }), dispatch: vi.fn() });
    expect(calls.find(call => call.method === 'PATCH')?.body).toMatchObject({ status: 'requested' });
  });

  it('carries a passed configuration forward to a newer release', async () => {
    const newer = releaseFixture(app, '1.141.0');
    newer.approvedAt = new Date(Date.parse(release.approvedAt) + 1000).toISOString();
    responses = { 'curated_config_verifications?select': [row({ status: 'passed' })] };
    await store.processConfigVerifications({ ...base, releases: [release, newer], runs: [], readEvidence: async () => { throw new Error('none'); }, dispatch: vi.fn() });
    const insert = calls.find(call => call.method === 'POST')!;
    expect(insert.body).toEqual([expect.objectContaining({ release_id: newer.id, status: 'requested', psadt_config_sha256: 'c'.repeat(64) })]);
  });
});
