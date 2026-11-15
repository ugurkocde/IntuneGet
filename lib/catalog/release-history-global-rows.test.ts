import { PGlite } from '@electric-sql/pglite';
import { auto_explain } from '@electric-sql/pglite/contrib/auto_explain';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261115133712_catalog_history_global_rows.sql', 'utf8');
const v8 = readFileSync('supabase/migrations/20261115083235_catalog_history_global_page_plan.sql', 'utf8');
const stripLocal = (sql: string) => sql.replace(/^SET LOCAL.*$/gm, '');
let db: PGlite;
let last: number;
let original: unknown;
beforeAll(async () => {
  db = new PGlite({ extensions: { auto_explain } });
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.curated_apps(winget_id text PRIMARY KEY,name text,publisher text,is_locale_variant boolean);
    CREATE TABLE public.version_history(id bigserial PRIMARY KEY,winget_id text,version text,release_date text,created_at timestamptz,installers jsonb,UNIQUE(winget_id,version));
    CREATE INDEX idx_version_history_winget_id ON public.version_history(winget_id);
    CREATE INDEX idx_version_history_winget_id_created_at_id ON public.version_history(winget_id,created_at,id);
    CREATE INDEX idx_version_history_observed ON public.version_history(created_at DESC,id DESC);
    CREATE TABLE public.curated_sync_status(id text PRIMARY KEY,last_run_status text,last_run_completed_at timestamptz,last_successful_sync_at timestamptz);
    INSERT INTO public.curated_apps SELECT 'Fixture.'||g,'App '||g,'Publisher',g>9055 FROM generate_series(1,16492)g;
    INSERT INTO public.version_history(winget_id,version,created_at,installers)
      SELECT 'Fixture.'||((g-1)%16492+1),(1+(g-1)/16492)::text,'2026-01-01'::timestamptz+g*interval '1 minute',
      jsonb_build_array(jsonb_build_object('Architecture','x64','Padding',repeat('p',1000))) FROM generate_series(1,74842)g;
    INSERT INTO public.version_history(winget_id,version,created_at,installers) VALUES
      ('Fixture.5','tie-a','2026-01-01 00:05','[]'),('Fixture.6','tie-b','2026-01-01 00:05','[]'),('Fixture.7','undated',NULL,'[]');
    INSERT INTO public.curated_apps VALUES ('No.History','Empty','Publisher',false);
    GRANT SELECT ON public.curated_apps,public.version_history,public.curated_sync_status TO service_role,anon,authenticated;
    ANALYZE;
  `);
  await db.exec(stripLocal(readFileSync('supabase/migrations/20261114230100_bound_catalog_history_app_plan.sql', 'utf8')));
  await db.exec(stripLocal(v8));
  original = (await db.query("SELECT md5(prosrc) body,proacl::text acl,prosecdef,proconfig FROM pg_proc WHERE oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure")).rows[0];
  await db.exec(stripLocal(v8.replace('public.get_catalog_release_history_v2(', 'pg_temp.catalog_v8(')));
  if (migration.trim()) await db.exec(stripLocal(migration));
  last = Math.ceil(Number((await db.query<{ total: number }>("SELECT (public.get_catalog_release_history_v2()->>'total')::int total")).rows[0].total) / 40);
}, 60000);
afterAll(async () => { await db?.close(); });
const full = async (page: number | null) => (await db.query<{ result: Record<string, unknown> }>(
  'SELECT pg_temp.catalog_v8(page_number=>$1::integer) result', [page],
)).rows[0].result;
// With an empty candidate migration the same contract measures the previous
// implementation, providing a genuine work-bound RED before the fix exists.
const rowsSql = migration.trim()
  ? 'SELECT public.get_catalog_release_history_global_rows($1::integer) result'
  : "SELECT public.get_catalog_release_history_v2(page_number=>$1::integer)->'rows' result";

it('preserves exact rows and page-independent summaries under both plan modes', async () => {
  for (const mode of ['force_generic_plan', 'force_custom_plan']) {
    await db.exec('SET plan_cache_mode=' + mode);
    const { rows: ignored, ...summary } = await full(1);
    void ignored;
    for (const page of [0, 1, 2, Math.floor(last / 2), last - 1, last, last + 1, 10000, null]) {
      const expected = await full(page);
      const actual = (await db.query<{ result: unknown }>(rowsSql, [page])).rows[0].result;
      expect(actual).toEqual(expected.rows);
      const { rows: otherRows, ...otherSummary } = expected;
      void otherRows;
      expect(otherSummary).toEqual(summary);
    }
  }
}, 60000);

type Node = Record<string, unknown> & { Plans?: Node[] };
async function work(sql: string, page: number, mode: string) {
  await db.exec("LOAD 'auto_explain'; SET auto_explain.log_min_duration=0; SET auto_explain.log_nested_statements=on; SET auto_explain.log_analyze=on; SET auto_explain.log_buffers=on; SET auto_explain.log_timing=off; SET auto_explain.log_format='json'; SET auto_explain.log_level='notice'; SET plan_cache_mode=" + mode);
  let buffers = 0;
  let scans = 0;
  await db.query(sql, [page], { onNotice: n => {
    const start = n.message.indexOf('{');
    if (start < 0) return;
    const plan = JSON.parse(n.message.slice(start)) as { Plan?: Node; 'Query Text'?: string };
    // Count relation work inside the function, never the wrapper a second time.
    if (String(plan['Query Text']).trim().toLowerCase().startsWith('select public.')) return;
    const visit = (node: Node) => {
      if (node['Relation Name']) buffers += Number(node['Shared Hit Blocks'] ?? 0) + Number(node['Shared Read Blocks'] ?? 0);
      if (node['Relation Name'] === 'version_history' && node['Node Type'] === 'Seq Scan' && Number(node['Actual Loops']) > 0) scans++;
      node.Plans?.forEach(visit);
    };
    if (plan.Plan) visit(plan.Plan);
  } });
  await db.exec('SET auto_explain.log_min_duration=-1');
  return { buffers, scans };
}
it('bounds deep-page work to one history scan and keeps page two indexed', async () => {
  for (const mode of ['force_generic_plan', 'force_custom_plan']) {
    const baseline = await work('SELECT public.get_catalog_release_history_v2(page_number=>$1::integer)', 1, mode);
    const deep = await work(rowsSql, last, mode);
    const shallow = await work(rowsSql, 2, mode);
    console.info('Synthetic global history work', { mode, baseline, deep, shallow });
    expect(baseline.buffers).toBeGreaterThan(0);
    expect(deep.scans).toBeLessThanOrEqual(1);
    expect(deep.buffers).toBeLessThan(baseline.buffers * 0.6);
    expect(shallow.buffers).toBeLessThan(1000);
  }
}, 60000);
it('preserves v2 body and ACL, restricts the additive function and supports rollback', async () => {
  expect((await db.query("SELECT md5(prosrc) body,proacl::text acl,prosecdef,proconfig FROM pg_proc WHERE oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure")).rows[0]).toEqual(original);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const row = (await db.query<{ allowed: boolean }>("SELECT has_function_privilege($1,'public.get_catalog_release_history_global_rows(integer)','EXECUTE') allowed", [role])).rows[0];
    expect(row.allowed).toBe(role === 'service_role');
    await db.exec('SET ROLE ' + role);
    try {
      if (role === 'service_role') await expect(db.query(rowsSql, [2])).resolves.toBeDefined();
      else await expect(db.query(rowsSql, [2])).rejects.toThrow(/permission denied/);
    } finally { await db.exec('RESET ROLE'); }
  }
  const security = (await db.query("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.get_catalog_release_history_global_rows(integer)'::regprocedure")).rows[0];
  expect(security).toEqual({ prosecdef: false, proconfig: ['search_path=""'] });
  await db.exec('DROP FUNCTION public.get_catalog_release_history_global_rows(integer)');
  expect(await full(2)).toEqual((await db.query<{ result: unknown }>('SELECT public.get_catalog_release_history_v2(page_number=>2) result')).rows[0].result);
});
