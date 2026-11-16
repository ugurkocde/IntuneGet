import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';

let db: PGlite;
let scopeMigration: string;
let beforeScope: Record<string, unknown>;
const canonical = JSON.stringify({ toolchain: { packagerCommit: 'a'.repeat(40) } });
const profile = createHash('sha256').update(canonical).digest('hex').toUpperCase();
const row = { winget_id: 'Example.App', version: '2.0', architecture: 'x64', sha256: 'b'.repeat(64), profile_sha256: profile,
  run_id: '123', packager_commit: 'a'.repeat(40), own: true, carried: false, outcome: 'Passed', vt_status: 'clean', malicious: 0, suspicious: 0, engines: 50, engine_version: 2 };
const heldSha = 'c'.repeat(64);
const carriedFailed = { ...row, version: '1.0', sha256: heldSha, run_id: '99', own: false, carried: true, outcome: 'Failed', vt_status: 'flagged', malicious: 1, engines: null, engine_version: null };
const call = async (rows: object[]) => (await db.query<{ v: { admitted: boolean; rows: { reason: string }[] } }>(
  'select check_qa_result_publication_admission($1,$2) v', ['local-fixture-only', JSON.stringify(rows)])).rows[0].v;
const migration = (name: string) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const definition = async () => String((await db.query<{ d: string }>("select pg_get_functiondef('check_qa_result_publication_admission(text,jsonb)'::regprocedure) d")).rows[0].d);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;create role anon;create role authenticated;create role service_role;
 create function authenticate_qa_installer_recheck(text) returns void language plpgsql as $$begin if $1 is distinct from 'local-fixture-only' then raise exception 'QA authentication rejected';end if;end$$;
 create table qa_candidates(winget_id text,version text,architecture text,installer_sha256 text,test_level text,package_profile_sha256 text,github_run_id text,test_config jsonb);
 create table qa_installer_security_holds(sha256 text,released_at timestamptz);
 create table package_eligibility_blocks(winget_id text);
 create table qa_package_blocks(winget_id text,version text,architecture text,installer_sha256 text);
 create table curated_excluded_apps(winget_id text,reason text);
 create table catalog_file_reputation(sha256 text,status text,malicious int,suspicious int,engine_count_version int,total_engines int);`);
  await db.exec(await migration('20261113032500_qa_publication_allrow_admission.sql'));
  // Only the disposable fixture normalizes pg_get_functiondef formatting for its PG build.
  await db.exec((await migration('20261113112519_qa_publication_capacity_preservation.sql'))
    .replace('3cead78d722323655ace7a1d803977285bc93cc38322c03e81246656e293aa51', digest(await definition())));
  beforeScope = (await db.query<Record<string, unknown>>("select pg_get_functiondef(oid) definition,proowner,proacl::text,prosecdef,proconfig,provolatile from pg_proc where oid='check_qa_result_publication_admission(text,jsonb)'::regprocedure")).rows[0];
  scopeMigration = (await migration('20261116153000_qa_publication_carried_failed_hold_scope.sql'))
    .replace('a477aef0018869863475243cf1a334bd7196568e50fba404ca257a7cc3cbda5f', digest(String(beforeScope.definition)));
  await db.exec(scopeMigration);
}, 30000);
beforeEach(async () => {
  await db.exec('truncate qa_candidates,qa_installer_security_holds,package_eligibility_blocks,qa_package_blocks,curated_excluded_apps,catalog_file_reputation');
  await db.query('insert into qa_candidates values($1,$2,$3,$4,$5,$6,$7,$8)', [row.winget_id, row.version, row.architecture, row.sha256, 'psadt-package', profile, row.run_id, JSON.stringify({ packageProfileCanonicalJson: canonical })]);
  await db.query("insert into catalog_file_reputation values($1,'found',0,0,2,50)", [row.sha256]);
  await db.query('insert into qa_installer_security_holds values($1,null)', [heldSha]);
});
afterAll(async () => db?.close());

it('admits a newer clean result when only an already-main Failed row carries a held hash', async () => {
  const result = await call([row, carriedFailed]);
  expect(result.admitted).toBe(true);
  expect(result.rows.map(r => r.reason)).toEqual(['clear', 'clear']);
});
it('still denies a held hash on a carried Passed row, a changed Failed row and the own row', async () => {
  for (const held of [{ ...carriedFailed, outcome: 'Passed' }, { ...carriedFailed, carried: false }]) {
    const result = await call([row, held]);
    expect(result.admitted).toBe(false);
    expect(result.rows[1].reason).not.toBe('clear');
  }
  await db.query('insert into qa_installer_security_holds values($1,null)', [row.sha256]);
  expect((await call([row, carriedFailed])).rows.map(r => r.reason)).toEqual(['hash_held', 'clear']);
  expect((await call([{ ...row, outcome: 'Failed' }])).rows[0].reason).toBe('hash_held');
});
it('keeps app, exclusion and tuple blocks on carried Failed rows', async () => {
  await db.query('insert into qa_package_blocks values($1,$2,$3,$4)', [carriedFailed.winget_id, carriedFailed.version, carriedFailed.architecture, heldSha.toUpperCase()]);
  await db.exec('delete from qa_installer_security_holds');
  expect((await call([row, carriedFailed])).rows[1].reason).toBe('tuple_blocked');
  await db.query('insert into package_eligibility_blocks values($1)', [row.winget_id]);
  expect((await call([row, carriedFailed])).rows.map(r => r.reason)).toEqual(['app_blocked', 'app_blocked']);
});
it('changes only the hash-hold condition and preserves every function property', async () => {
  const after = (await db.query<Record<string, unknown>>("select pg_get_functiondef(oid) definition,proowner,proacl::text,prosecdef,proconfig,provolatile from pg_proc where oid='check_qa_result_publication_admission(text,jsonb)'::regprocedure")).rows[0];
  expect(after).toEqual({ ...beforeScope, definition: String(beforeScope.definition).replace(
    "h.released_at is null) then reason := 'hash_held';",
    "h.released_at is null)\n        and not ((r->>'carried')::boolean and r->>'outcome'='Failed') then reason := 'hash_held';") });
  await expect(db.exec(scopeMigration)).rejects.toThrow(/source drift/);
});
