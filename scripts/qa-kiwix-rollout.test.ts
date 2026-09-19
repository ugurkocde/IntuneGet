import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pin = 'e79da0398e3cf3c6874e53b6304a2aef54b5770f';
const script = pathToFileURL(resolve('scripts/qa-kiwix-rollout.mjs')).href;

function rejectedRun(action: string, reason: string, base = 'https://mbhajocqtogfbgojkwhd.supabase.co') {
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
process.argv = ['node', 'fixture', ${JSON.stringify(action)}, ${JSON.stringify(pin)}];
globalThis.fetch = async (url, options) => {
  if (options.method !== 'GET') throw Error('UNEXPECTED MUTATION');
  const u = new URL(url);
  const data = u.pathname.endsWith('/qa_pipeline_control') ? [{
    paused: true, reason: ${JSON.stringify(reason)}, required_packager_commit: '${pin}',
    scheduler_packager_commit: '${pin}', scheduler_seen_at: new Date().toISOString(),
  }] : u.searchParams.get('status') === 'eq.passed' ? [{
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
