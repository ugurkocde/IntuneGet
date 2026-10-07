import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../supabase/migrations/20261007224438_qa_candidate_conflict_free_insert.sql', import.meta.url), 'utf8');
let db: PGlite;
const candidate = {
  winget_id: 'Example.App', version: '1', architecture: 'x64',
  installer_url: 'https://example.test/setup.exe', installer_sha256: 'A'.repeat(64),
  installer_type: 'nullsoft', installer_file_name: 'setup.exe',
  package_profile_sha256: 'B'.repeat(64), test_level: 'psadt-package',
  status: 'queued', priority: 1000, demand_source: 'customer', test_config: { marker: 'original' },
};
const insert = async (row = candidate) => {
  const result = await db.query<{ result: { outcome: string; candidate: { id: string; status: string } } }>(
    'select insert_qa_candidate_if_absent($1::jsonb) result', [JSON.stringify(row)]);
  const outcome = result.rows[0].result;
  return { ...outcome, rows: outcome.outcome === 'inserted' ? [outcome.candidate] : [] };
};

describe('conflict-free QA candidate insertion', () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table curated_apps(winget_id text primary key);
      insert into curated_apps values ('Example.App'),('example.app'),('Other.App');
      create table qa_candidates(
        id uuid primary key default gen_random_uuid(),
        winget_id text not null references curated_apps(winget_id), definition_path text,
        version text not null, architecture text not null,
        installer_url text not null, installer_sha256 text not null check(installer_sha256 ~ '^[A-F0-9]{64}$'),
        installer_type text not null, installer_file_name text not null,
        test_level text not null, package_profile_sha256 text not null,
        test_config jsonb not null default '{}', catalog_version_at_enqueue text,
        status text not null, priority integer not null default 0, demand_source text not null default 'catalog',
        failure_summary text, finished_at timestamptz, updated_at timestamptz not null default now(),
        attempts integer not null default 0, enqueued_at timestamptz not null default now()
      );
      create unique index qa_candidates_exact_package_key on qa_candidates
        (winget_id,version,architecture,installer_sha256,package_profile_sha256) where package_profile_sha256 is not null;
      create unique index qa_candidates_one_active_payload_idx on qa_candidates
        (lower(winget_id),version,lower(architecture),upper(installer_sha256))
        where test_level='psadt-package' and status in ('queued','dispatched','running');
      create unique index qa_candidates_single_active_idx on qa_candidates ((true)) where status in ('dispatched','running');
    `);
    await db.exec(migration);
  });
  afterEach(async () => { await db.close(); });

  it.each(['queued', 'running', 'passed', 'failed', 'error', 'superseded'])('reuses exact %s without overwriting evidence or attempts', async status => {
    await insert();
    await db.query('update qa_candidates set status=$1,attempts=3,failure_summary=$2', [status, 'retained']);
    const before = (await db.query('select * from qa_candidates')).rows;
    expect((await insert({ ...candidate, priority: 2000, test_config: { marker: 'replacement' } })).rows).toEqual([]);
    expect((await db.query('select * from qa_candidates')).rows).toEqual(before);
  });

  it('arbitrates competing exact inserts into one row', async () => {
    const results = await Promise.all([insert(), insert(), insert()]);
    expect(results.map(result => result.rows.length).sort()).toEqual([0, 0, 1]);
    expect((await db.query('select count(*)::int n from qa_candidates')).rows).toEqual([{ n: 1 }]);
  });

  it('ignores a normalized active payload conflict across different profiles', async () => {
    await insert();
    const result = await insert({ ...candidate, winget_id: 'example.app', package_profile_sha256: 'C'.repeat(64) });
    expect(result.outcome).toBe('active_conflict');
    expect(result.candidate.status).toBe('queued');
    expect(result.rows).toEqual([]);
    expect((await db.query('select count(*)::int n from qa_candidates')).rows).toEqual([{ n: 1 }]);
  });

  it('allows a new version and a new profile after the prior lifecycle ended', async () => {
    await insert();
    expect((await insert({ ...candidate, version: '2' })).rows).toHaveLength(1);
    await db.exec("update qa_candidates set status='passed'");
    expect((await insert({ ...candidate, package_profile_sha256: 'C'.repeat(64) })).rows).toHaveLength(1);
  });

  it.each(['running', 'dispatched', 'error', 'failed'])('refuses direct lifecycle state %s', async status => {
    await expect(insert({ ...candidate, status })).rejects.toThrow('Unsupported QA candidate insertion state');
  });

  it('keeps validation and foreign-key failures visible', async () => {
    await expect(insert({ ...candidate, installer_sha256: 'bad' })).rejects.toThrow(/check constraint/);
    await expect(insert({ ...candidate, winget_id: 'Missing.App' })).rejects.toThrow(/foreign key/);
  });

  it('rejects lifecycle metadata and inconsistent terminal states', async () => {
    await expect(insert({ ...candidate, id: '00000000-0000-4000-8000-000000000001' } as typeof candidate)).rejects.toThrow('Unsupported QA candidate fields');
    await expect(insert({ ...candidate, github_run_id: '123' } as typeof candidate)).rejects.toThrow('Unsupported QA candidate fields');
    await expect(insert({ ...candidate, status: 'passed' })).rejects.toThrow('Unsupported QA candidate insertion state');
    await expect(insert({ ...candidate, test_level: 'installer-preflight' })).rejects.toThrow('Unsupported QA candidate insertion state');
  });

  it('does not silently swallow an unrelated unique constraint', async () => {
    await insert();
    await db.exec('create unique index unexpected_filename_key on qa_candidates(installer_file_name)');
    await expect(insert({ ...candidate, winget_id: 'Other.App' })).rejects.toThrow(/unexpected_filename_key/);
  });

  it('is invoker-only and inaccessible to public client roles', async () => {
    const roles = await db.query(`select prosecdef,
      has_function_privilege('anon','insert_qa_candidate_if_absent(jsonb)','execute') anon,
      has_function_privilege('authenticated','insert_qa_candidate_if_absent(jsonb)','execute') authenticated,
      has_function_privilege('service_role','insert_qa_candidate_if_absent(jsonb)','execute') service
      from pg_proc where proname='insert_qa_candidate_if_absent'`);
    expect(roles.rows).toEqual([{ prosecdef: false, anon: false, authenticated: false, service: true }]);
    await db.exec('set role anon');
    await expect(insert()).rejects.toThrow(/permission denied/);
  });
});
