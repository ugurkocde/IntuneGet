import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const migration = readFileSync('supabase/migrations/20261115144200_qa_demand_failure_key_scope.sql', 'utf8').replace(/\r\n/g, '\n');
const old = readFileSync('supabase/migrations/20260823195500_recognize_live_qa_version_coverage.sql', 'utf8').replace(/\r\n/g, '\n');
const timeout = readFileSync('supabase/migrations/20261115020254_qa_optional_backfill_timeout.sql', 'utf8');
const fixture = readFileSync('scripts/ci/qa-demand-index-postgres.py', 'utf8').split('FIXTURE = """')[1].split('insert into curated_apps')[0];
const stubLiteral = readFileSync('scripts/ci/qa-demand-index-postgres.py', 'utf8').match(/run\(("create function public\.qa_idle_catalog_backfill_ids[^\r\n]+")\)/)?.[1];
if (!stubLiteral) throw new Error('Missing CI timeout fixture functions');
it.each([false, true])('preserves existing timeout configuration: %s', async hasTimeout => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;'+fixture+old);
    await db.exec(JSON.parse(stubLiteral));
    if (hasTimeout) await db.exec(timeout);
    const snapshot = async () => (await db.query("SELECT proacl::text,proconfig,prosecdef,provolatile FROM pg_proc WHERE oid='public.qa_missing_demand_backfill_ids(integer)'::regprocedure")).rows[0];
    const before = await snapshot();
    await db.exec('BEGIN;'+migration+'COMMIT;');
    expect(await snapshot()).toEqual(before);
    const config = (await db.query<{ proconfig: string[] }>("SELECT proconfig FROM pg_proc WHERE oid='public.qa_missing_demand_backfill_ids(integer)'::regprocedure")).rows[0].proconfig;
    expect(config.includes('statement_timeout=2s')).toBe(hasTimeout);
    expect((await db.query('SELECT * FROM public.qa_missing_demand_backfill_ids(5)')).rows).toEqual([]);
  } finally { await db.close(); }
}, 20000);
it('rejects an unexpected NULL configuration without changing the function', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;'+fixture+old);
    await db.exec('ALTER FUNCTION public.qa_missing_demand_backfill_ids(integer) RESET ALL;');
    const snapshot = async () => (await db.query("SELECT md5(prosrc),proacl::text,proconfig,prosecdef FROM pg_proc WHERE oid='public.qa_missing_demand_backfill_ids(integer)'::regprocedure")).rows[0];
    const before = await snapshot();
    expect(before.proconfig).toBeNull();
    await expect(db.exec('BEGIN;'+migration+'COMMIT;')).rejects.toThrow('Demand function source or configuration changed');
    await db.exec('ROLLBACK;');
    expect(await snapshot()).toEqual(before);
  } finally { await db.close(); }
}, 20000);
