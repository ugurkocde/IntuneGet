import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pin = 'e79da0398e3cf3c6874e53b6304a2aef54b5770f';
const script = pathToFileURL(resolve('scripts/qa-kiwix-rollout.mjs')).href;

function rejectedRun(action: string, reason: string, base = 'https://mbhajocqtogfbgojkwhd.supabase.co', requestedPin = pin, fixture: { seen?: string; candidate?: object; queuedCount?: number } = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
process.argv = ['node', 'fixture', ${JSON.stringify(action)}, ${JSON.stringify(requestedPin)}];
const fixture = ${JSON.stringify(fixture)};
globalThis.fetch = async (url, options) => {
  if (options.method !== 'GET') throw Error('UNEXPECTED MUTATION');
  const u = new URL(url);
  const data = u.pathname.endsWith('/qa_pipeline_control') ? [{
    paused: true, reason: ${JSON.stringify(reason)}, required_packager_commit: '${pin}',
    scheduler_packager_commit: '${pin}', scheduler_seen_at: fixture.seen || new Date().toISOString(),
  }] : u.searchParams.get('status') === 'eq.queued' ? Array.from({length: fixture.queuedCount || 0}, () => ({})) :
    u.pathname.endsWith('/qa_package_results') ? [] :
    (u.searchParams.get('status') === 'eq.passed' || ${JSON.stringify(action)} === 'pause-retry') ? [fixture.candidate || {
    id: 'wrong-profile', package_profile_sha256: 'A'.repeat(64),
    test_config: {packageProfileCanonicalJson: JSON.stringify({
      toolchain: {packagerCommit: '${pin}'}, installer: {uninstallCommand: 'REGISTRY_UNINSTALL:Other'},
    })},
  }] : [];
  return new Response(JSON.stringify(data));
};
await import(${JSON.stringify(script)});
`], { encoding: 'utf8', env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'test-only' } });
}

describe('guarded Kiwix production rollout', () => {
  const reason = 'Kiwix exact repaired application validation in progress.';
  it('refuses a potentially truncated queue before retiring any row', () => {
    const r = rejectedRun('retire-old-queue', reason, undefined, pin, { queuedCount: 1000 });
    expect(r.stderr).toContain('Queue exceeds bounded rollout; no rows retired');
    expect(r.stderr).not.toContain('UNEXPECTED MUTATION');
  });
  const canonical = JSON.stringify({
    testLevel: 'psadt-package', toolchain: { packagerCommit: pin },
    app: { wingetId: 'Kiwix.Wikivoyage.Electron', version: '3.8.2-E', architecture: 'x86' },
    installer: { sha256: '353BFC413A3787D7CEA738AB8BAAAB7E33AF42883963D2C29DDEDA438BFFF0C0', installScope: 'machine',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:149170a6-d630-5e6f-a054-8c34dd8a32a2:Wikivoyage by Kiwix' },
  });
  const candidate = {
    id: 'exact-profile', winget_id: 'Kiwix.Wikivoyage.Electron', version: '3.8.2-E', architecture: 'x86',
    installer_sha256: '353BFC413A3787D7CEA738AB8BAAAB7E33AF42883963D2C29DDEDA438BFFF0C0',
    test_level: 'psadt-package', package_profile_sha256: createHash('sha256').update(canonical).digest('hex').toUpperCase(),
    test_config: { mode: 'psadt-package', packageProfileCanonicalJson: canonical },
  };
  it.each(['invalid', '2099-01-01T00:00:00Z', '2020-01-01T00:00:00Z'])('rejects an invalid, future, or stale heartbeat: %s', (seen) => {
    expect(rejectedRun('complete-retry', reason, undefined, pin, { seen }).stderr).toContain('Fresh aligned scheduler pin required');
  });
  it('requires the stored hash to identify the canonical repaired profile', () => {
    const r = rejectedRun('complete-retry', reason, undefined, pin,
      { candidate: { ...candidate, package_profile_sha256: 'B'.repeat(64) } });
    expect(r.stderr).toContain('Exactly one passed repaired lifecycle required');
    const valid = rejectedRun('complete-retry', reason, undefined, pin, { candidate });
    expect(valid.stderr).toContain('Strict mechanical lifecycle evidence required');
  });
  it('refuses to pause for an active lifecycle with a different installer payload', () => {
    const r = rejectedRun('pause-retry', reason, undefined, pin,
      { candidate: { ...candidate, installer_sha256: 'B'.repeat(64) } });
    expect(r.stderr).toContain('Exact active retry required');
    expect(r.stderr).not.toContain('UNEXPECTED MUTATION');
  });
  it('rejects a valid-looking commit that is not the reviewed repair pin', () => {
    const r = rejectedRun('set-pin', 'test', undefined, 'a'.repeat(40));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Production environment and full reviewed pin required');
  });
  it('rejects a non-TLS production URL before accessing production', () => {
    const r = rejectedRun('complete-retry', 'test', 'http://mbhajocqtogfbgojkwhd.supabase.co');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Production environment and full reviewed pin required');
  });
  it.each(['resume-retry', 'complete-retry'])('preserves unrelated pauses during %s', (action) => {
    const r = rejectedRun(action, 'Unrelated maintenance hold');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Unrelated pause must remain in place');
    expect(r.stderr).not.toContain('UNEXPECTED MUTATION');
  });
  it('rejects a passed current-pin result for a different uninstall profile', () => {
    const r = rejectedRun('complete-retry', 'Kiwix exact repaired application validation in progress.');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Exactly one passed repaired lifecycle required');
    expect(r.stderr).not.toContain('UNEXPECTED MUTATION');
  });
});
