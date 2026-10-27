import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { arePackageDependenciesCovered } from './dependency-reputation';

const now = Date.parse('2026-10-27T05:00:00Z');
const hash = 'a'.repeat(64);
const dependencies = [{ installerSha256: hash.toUpperCase() }];
const clean = {
  sha256: hash, status: 'found', malicious: 0, suspicious: 0,
  total_engines: 70, engine_count_version: 2,
  checked_at: '2026-10-27T04:00:00Z', analyzed_at: '2026-10-26T04:00:00Z',
  retry_after: '2026-11-03T04:00:00Z',
};

function client(rows: Record<string, unknown>[] = [clean], held = false, error = false) {
  return {
    from: (table: string) => {
      const result = table === 'qa_installer_security_holds'
        ? { data: held ? [{ sha256: hash, next_check_at: '2026-10-28T04:00:00Z', malicious_verdicts: 1 }] : [], error: null }
        : { data: rows, error: error ? { message: 'unavailable' } : null };
      const query = {
        select: () => query, in: () => query, is: () => query,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe('dependency reputation admission', () => {
  it('accepts fresh covered clean bytes with no active hold', async () => {
    await expect(arePackageDependenciesCovered(client(), dependencies, now)).resolves.toBe(true);
  });

  it.each([
    { status: 'not_found' }, { malicious: 1 }, { suspicious: 1 },
    { engine_count_version: 1 }, { total_engines: 0 }, { total_engines: null },
    { total_engines: 10000 }, { total_engines: 1.5 },
    { checked_at: null }, { checked_at: 'invalid' },
    { checked_at: '2026-10-20T05:00:00Z' },
    { checked_at: '2026-10-27T05:00:01Z' },
    { analyzed_at: null }, { analyzed_at: '2026-10-27T05:00:01Z' },
    { retry_after: null }, { retry_after: '2026-10-27T05:00:00Z' },
  ])('holds uncovered or adverse dependency evidence: %j', async change => {
    await expect(arePackageDependenciesCovered(client([{ ...clean, ...change }]), dependencies, now))
      .resolves.toBe(false);
  });

  it('requires exactly one matching row for every dependency', async () => {
    for (const rows of [[], [{ ...clean, sha256: 'b'.repeat(64) }], [clean, clean]]) {
      await expect(arePackageDependenciesCovered(client(rows), dependencies, now)).resolves.toBe(false);
    }
    await expect(arePackageDependenciesCovered(client(), [...dependencies, { installerSha256: 'B'.repeat(64) }], now))
      .resolves.toBe(false);
  });

  it('preserves active holds even when the cache is clean', async () => {
    await expect(arePackageDependenciesCovered(client([clean], true), dependencies, now)).resolves.toBe(false);
  });

  it('does not turn unavailable evidence into coverage', async () => {
    await expect(arePackageDependenciesCovered(client([], false, true), dependencies, now))
      .rejects.toThrow('Dependency reputation is unavailable');
  });

  it('does not read reputation for an empty bundle', async () => {
    await expect(arePackageDependenciesCovered({} as SupabaseClient, [], now)).resolves.toBe(true);
  });

  it('rejects invalid hashes and oversized bundles before any read', async () => {
    for (const deps of [[{ installerSha256: 'invalid' }], [{ installerSha256: '0'.repeat(64) }], Array(9).fill(dependencies[0])]) {
      await expect(arePackageDependenciesCovered({} as SupabaseClient, deps, now)).resolves.toBe(false);
    }
  });
});
