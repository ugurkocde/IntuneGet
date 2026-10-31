import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackagerConfig } from '../src/config.js';
import type { JobClaimResult, PackagingJob } from '../src/job-poller.js';

const state = vi.hoisted(() => ({
  job: {} as PackagingJob, rows: [] as Array<{ sha256: string; released_at?: string }>,
  readError: false, thrown: false, nullData: false, writeError: false,
  hash: '', reads: 0, writes: [] as Record<string, unknown>[], predicates: [] as unknown[][],
}));
vi.mock('../src/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (table: string) => {
  if (table === 'qa_installer_security_holds') return { select: () => ({ eq: (_key: string, hash: string) => {
    state.hash = hash;
    return { is: async (key: string, value: unknown) => {
      state.reads++; state.predicates.push([key, value]);
      if (state.thrown) throw new Error('Synthetic unavailable reader');
      return { data: state.nullData ? null : state.rows.filter(row => row.sha256 === hash && !row.released_at), error: state.readError ? { message: 'Synthetic failure' } : null };
    } };
  } }) };
  if (table !== 'packaging_jobs') throw new Error('Unexpected fixture table');
  const builder = { eq: (...args: unknown[]) => { state.predicates.push(args); return builder; },
    order: () => builder, limit: async () => ({ data: [state.job], error: null }),
    select: () => builder, single: async () => ({ data: state.job, error: null }),
    maybeSingle: async () => ({ data: state.writeError ? null : { id: state.job.id }, error: state.writeError ? { message: 'Synthetic write failure' } : null }) };
  return { select: () => builder, update: (value: Record<string, unknown>) => { state.writes.push(value); return builder; } };
} }) }));
import { JobPoller } from '../src/job-poller.js';

const config = { mode: 'supabase', packagerId: 'fixture-packager', supabase: { url: 'https://example.test', serviceRoleKey: 'synthetic-fixture' } } as PackagerConfig;
const claim = () => (new JobPoller(config) as unknown as { claimNextJobViaSupabase(): Promise<JobClaimResult> }).claimNextJobViaSupabase();
const hash = 'a'.repeat(64);
beforeEach(() => {
  state.job = { id: 'fixture-job', winget_id: 'IntuneGet.Curated.Fixture', installer_sha256: hash.toUpperCase(),
    package_config: { sourceType: 'curated', curatedReleaseId: 'fixture-release' } } as PackagingJob;
  state.rows = []; state.readError = false; state.thrown = false; state.nullData = false; state.writeError = false;
  state.hash = ''; state.reads = 0; state.writes = []; state.predicates = [];
});

describe('direct Supabase curated local claim', () => {
  for (const custom of [false, true]) {
    describe(custom ? 'verified custom profile' : 'default profile', () => {
      beforeEach(() => { state.job.package_config = { sourceType: 'curated', curatedReleaseId: 'fixture-release', psadtConfig: custom ? { deployMode: 'Interactive' } : {} }; });
      it.each(['held', 'readError', 'thrown', 'nullData', 'invalidHash', 'zeroHash', 'newlineHash'] as const)('does not hand off execution with %s', async condition => {
        if (condition === 'held') state.rows = [{ sha256: hash }];
        else if (condition === 'invalidHash') state.job.installer_sha256 = 'invalid';
        else if (condition === 'zeroHash') state.job.installer_sha256 = '0'.repeat(64);
        else if (condition === 'newlineHash') state.job.installer_sha256 = hash + '\n';
        else state[condition] = true;
        const result = await claim(); expect(result.claimed).toBe(false); expect(result.job).toBeUndefined();
        expect(state.writes).toContainEqual(expect.objectContaining({ status: 'awaiting_qa', packager_id: null, claimed_at: null }));
        expect(state.predicates).toContainEqual(['packager_id', 'fixture-packager']);
      });
      it.each(['clean', 'released', 'unrelated'] as const)('retains an eligible %s exact installer', async condition => {
        if (condition === 'released') state.rows = [{ sha256: hash, released_at: '2030-01-01T00:00:00Z' }];
        if (condition === 'unrelated') state.rows = [{ sha256: 'b'.repeat(64) }];
        expect(await claim()).toMatchObject({ claimed: true, job: { id: 'fixture-job' } });
        expect(state.hash).toBe(hash); expect(state.predicates).toContainEqual(['released_at', null]);
        expect(state.writes).toHaveLength(1);
      });
    });
  }
  it('cannot bypass a hold with a QA override or a disguised custom source', async () => {
    state.rows = [{ sha256: hash }]; state.job.package_config = { sourceType: 'custom', qaOverride: true };
    expect((await claim()).claimed).toBe(false);
  });
  it('refuses execution even if recording the waiting state fails', async () => {
    state.rows = [{ sha256: hash }]; state.writeError = true;
    expect((await claim()).claimed).toBe(false);
  });
  it('preserves ordinary non curated claims without introducing a security read', async () => {
    state.job.winget_id = 'Fixture.Ordinary'; state.job.package_config = { sourceType: 'winget' }; state.thrown = true;
    expect((await claim()).claimed).toBe(true); expect(state.reads).toBe(0);
  });
});
