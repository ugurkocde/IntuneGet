import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('./qa-yuanfudao-quarantine.mjs', import.meta.url), 'utf8')
  .replace("import { createHash } from 'node:crypto';", '');
const pin = '4b4637967c6e2b0188f5713d262dd1219a02465e';
const candidateId = '7f30e76f-eb50-4da8-b48b-2ca6f3692b97';
const profileHash = 'A94CC273238C871F898FF722E08AA83EEAA9481470AFDF7F3BC31CBEC0302FD1';
const sha = '0AABCD7B3C471C4C27269874ABC88F338A55E170C3FCF7D132B577B3FB9BA6F2';

async function execute(action: string, options: {
  active?: boolean; stale?: boolean; corruptHash?: boolean; badRemoval?: boolean; missingBlock?: boolean;
} = {}) {
  const writes: { table: string; params: URLSearchParams; body: Record<string, unknown> }[] = [];
  let blocked = action === 'resume' && !options.missingBlock;
  const control = { paused: true, reason: `Automated QA failure: candidate ${candidateId}.`,
    updated_at: '2026-09-23T11:32:45Z', required_packager_commit: pin, scheduler_packager_commit: pin,
    scheduler_seen_at: new Date(Date.now() - (options.stale ? 600000 : 0)).toISOString() };
  const canonical = JSON.stringify({ app: { wingetId: 'Yuanfudao.Yuanfudao', version: '7.31.0', architecture: 'x64' },
    testLevel: 'psadt-package', installer: { sha256: sha }, toolchain: { packagerCommit: pin } });
  const fetch = vi.fn(async (url: string, init: { method: string; body?: string }) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split('/').at(-1)!;
    if (init.method !== 'GET') {
      writes.push({ table, params: parsed.searchParams, body: JSON.parse(init.body!) });
      if (table === 'qa_package_blocks') blocked = true;
      return { ok: true, json: async () => [{ id: 'global' }] };
    }
    const data = table === 'qa_pipeline_control' ? [control]
      : table === 'qa_package_blocks' ? (blocked ? [{ block_code: 'failed_managed_lifecycle' }] : [])
      : table === 'qa_package_results' ? [{ outcome: 'Failed', packager_commit: pin,
        environment: { executionContext: 'LocalSystem' }, virustotal_malicious: null, virustotal_suspicious: null,
        phase_results: { install: { exitCode: 0 }, detectionAfterInstall: { exitCode: 0 },
          uninstall: { exitCode: 60001 }, detectionAfterUninstall: { exitCode: options.badRemoval ? 1 : 0 } } }]
      : parsed.searchParams.get('status') === 'in.(dispatched,running)' ? (options.active ? [{ id: 'active' }] : [])
      : [{ id: candidateId, github_run_id: '35852626457', package_profile_sha256: profileHash,
        finished_at: '2026-09-23T11:32:45Z', test_config: { mode: 'psadt-package', packageProfileCanonicalJson: canonical } }];
    return { ok: true, json: async () => data };
  });
  // Exercise the real operator script with isolated HTTP responses. Hash behavior
  // is injected so tests can separately prove the corrupt-profile guard.
  const promise = runInNewContext(`(async () => { ${source} })()`, {
    process: { argv: ['node', 'script', action], env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://mbhajocqtogfbgojkwhd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only' } },
    URL, URLSearchParams, AbortSignal, Date, fetch, console: { log: vi.fn() },
    createHash: () => ({ update: (value: string) => ({ digest: () => value === canonical && !options.corruptHash ? profileHash : 'invalid' }) }),
  });
  return { promise, writes };
}

describe('Yuanfudao guarded exact-payload containment', () => {
  it('writes only the exact block and safely undispatched matching rows', async () => {
    const { promise, writes } = await execute('block');
    await promise;
    expect(writes.map(w => w.table)).toEqual(['qa_package_blocks', 'qa_candidates']);
    expect(writes[0].body).toMatchObject({ winget_id: 'Yuanfudao.Yuanfudao', version: '7.31.0',
      architecture: 'x64', installer_sha256: sha, block_code: 'failed_managed_lifecycle' });
    expect(Object.fromEntries(writes[1].params)).toMatchObject({ status: 'eq.queued', dispatched_at: 'is.null',
      github_run_id: 'is.null', installer_sha256: `eq.${sha}`, version: 'eq.7.31.0' });
  });
  it.each([{ active: true }, { corruptHash: true }, { badRemoval: true }])('refuses mutation for %j', async options => {
    const { promise, writes } = await execute('block', options);
    await expect(promise).rejects.toThrow();
    expect(writes).toEqual([]);
  });
  it.each([{ stale: true }, { missingBlock: true }, { active: true }])('refuses resume for %j', async options => {
    const { promise, writes } = await execute('resume', options);
    await expect(promise).rejects.toThrow();
    expect(writes).toEqual([]);
  });
  it('conditionally resumes only the exact paused control revision and pin', async () => {
    const { promise, writes } = await execute('resume');
    await promise;
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe('qa_pipeline_control');
    expect(Object.fromEntries(writes[0].params)).toMatchObject({ paused: 'eq.true',
      required_packager_commit: `eq.${pin}`, scheduler_packager_commit: `eq.${pin}`,
      updated_at: 'eq.2026-09-23T11:32:45Z' });
  });
});
