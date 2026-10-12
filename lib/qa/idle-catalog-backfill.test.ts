import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const original = readFileSync(new URL('../../supabase/migrations/20260824101502_add_qa_idle_catalog_backfill.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/20261008080541_qa_idle_catalog_backfill_due_waiting_work.sql', import.meta.url), 'utf8');
let db: PGlite;
const select = async (limit: number | null = 3) => (await db.query<{ winget_id: string }>(
  'select * from public.qa_idle_catalog_backfill_ids($1)', [limit])).rows.map(row => row.winget_id);
const candidate = async (status: string, retry = "now()+interval '1 day'", app = 'Deferred.App') => db.query(
  `insert into qa_candidates(winget_id,status,next_retry_at) values ($1,$2,${retry})`, [app, status]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table qa_poll_runs(id integer);
    create table curated_apps(winget_id text primary key, latest_version text default '1',
      is_verified boolean default true, is_winget_verified boolean default true,
      app_source text default 'win32', is_locale_variant boolean default false,
      popularity_rank integer, chocolatey_downloads bigint default 0, updated_at timestamptz default now());
    create table qa_candidates(winget_id text, version text default '1', catalog_version_at_enqueue text,
      test_level text default 'psadt-package', status text, next_retry_at timestamptz not null default '-infinity',
      test_config jsonb default '{"profileKind":"catalog-default"}', priority integer default 1, attempts integer default 2);
    create table package_eligibility_blocks(winget_id text);
    create table qa_package_blocks(winget_id text, version text);
    create table qa_catalog_reconciliations(winget_id text, catalog_version text, observed_head_sha text);
    create table qa_winget_poll_state(id text, head_sha text);`);
  await db.exec(original);
  await db.exec("insert into curated_apps(winget_id) values ('Example.App')");
  await candidate('queued');
  expect(await select()).toEqual([]); // Reproduce the original starvation before upgrading.
  await db.exec(migration);
  expect(await select()).toEqual(['Example.App']);
}, 30000);
beforeEach(async () => {
  await db.exec(`truncate curated_apps,qa_candidates,package_eligibility_blocks,qa_package_blocks,
    qa_catalog_reconciliations,qa_winget_poll_state;
    insert into curated_apps(winget_id,popularity_rank) values ('Example.App',1),('Other.App',2);`);
});
afterAll(async () => db?.close());

describe('retry-aware idle catalog backfill', () => {
  it('uses idle capacity without changing deferred candidate evidence', async () => {
    await candidate('queued');
    const before = (await db.query('select * from qa_candidates')).rows;
    expect(await select()).toEqual(['Example.App', 'Other.App']);
    expect((await db.query('select * from qa_candidates')).rows).toEqual(before);
  });
  it.each(['now()', "now()-interval '1 minute'", "'-infinity'::timestamptz"])(
    'leaves capacity to waiting work due at %s', async retry => {
      await candidate('queued', retry);
      expect(await select()).toEqual([]);
    });
  it.each(['dispatched', 'running'])('never backfills alongside %s work', async status => {
    await candidate('queued');
    await candidate(status);
    expect(await select()).toEqual([]);
  });
  it.each([
    "is_verified=false", "is_winget_verified=false", "app_source='msix'",
    "is_locale_variant=true", "latest_version=' '", "latest_version=null",
  ])('preserves catalog qualification: %s', async update => {
    await db.exec(`update curated_apps set ${update} where winget_id='Example.App'`);
    expect(await select()).toEqual(['Other.App']);
  });
  it.each([
    "insert into package_eligibility_blocks values ('Example.App')",
    "insert into qa_package_blocks values ('Example.App','1')",
    "insert into qa_winget_poll_state values ('microsoft/winget-pkgs','head'); insert into qa_catalog_reconciliations values ('Example.App','1','head')",
  ])('preserves blocking and current reconciliation: %s', async setup => {
    await db.exec(setup);
    expect(await select()).toEqual(['Other.App']);
  });
  it.each(['version', 'catalog_version_at_enqueue'])('deduplicates current coverage through %s', async column => {
    await candidate('passed', 'now()', 'Example.App');
    await db.exec("update qa_candidates set version='old',catalog_version_at_enqueue='old'");
    await db.exec(`update qa_candidates set ${column}='1'`);
    expect(await select()).toEqual(['Other.App']);
  });
  it('allows superseded coverage, other profiles and stale reconciliation', async () => {
    await candidate('superseded', 'now()', 'Example.App');
    await candidate('passed', 'now()', 'Other.App');
    await db.exec(`update qa_candidates set test_config='{"profileKind":"diagnostic"}' where winget_id='Other.App';
      insert into qa_winget_poll_state values ('microsoft/winget-pkgs','new');
      insert into qa_catalog_reconciliations values ('Example.App','1','old');`);
    expect(await select()).toEqual(['Example.App', 'Other.App']);
  });
  it('retains popularity, download, recency and stable ID ordering and limit clamps', async () => {
    await db.exec(`truncate curated_apps;
      insert into curated_apps(winget_id,popularity_rank,chocolatey_downloads,updated_at) values
        ('B',1,10,'2026-01-02'),('A',1,10,'2026-01-02'),('Old',1,10,'2026-01-01'),
        ('Less',1,9,'2026-01-03'),('Rank',2,100,'2026-01-03'),('Null',null,1000,'2026-01-03');
      insert into curated_apps(winget_id,popularity_rank) select 'Tail.'||n,10+n from generate_series(1,25) n;`);
    expect((await select(20)).slice(0,6)).toEqual(['A','B','Old','Less','Rank','Tail.1']);
    expect(await select(0)).toEqual(['A']);
    expect(await select(-10)).toEqual(['A']);
    expect(await select(null)).toEqual(['A','B','Old']);
    expect(await select(100)).toHaveLength(20);
    expect((await select(20))).not.toContain('Null');
  });
  it('keeps invoker security, an empty search path and service-only execution', async () => {
    const result = await db.query(`select prosecdef,provolatile,proconfig,
      has_function_privilege('anon','qa_idle_catalog_backfill_ids(integer)','execute') anon,
      has_function_privilege('authenticated','qa_idle_catalog_backfill_ids(integer)','execute') authenticated,
      has_function_privilege('service_role','qa_idle_catalog_backfill_ids(integer)','execute') service
      from pg_proc where proname='qa_idle_catalog_backfill_ids'`);
    expect(result.rows).toEqual([{ prosecdef: false, provolatile: 's', proconfig: ['search_path=""'], anon: false, authenticated: false, service: true }]);
  });
  it('changes only the due-time predicate in the function body', () => {
    const body = (sql: string) => sql.split('as $$')[1].split('$$;')[0];
    expect(body(migration)).toBe(body(original).replace("where waiting_work.status = 'queued'", "where waiting_work.status = 'queued' and waiting_work.next_retry_at <= now()"));
  });
});
