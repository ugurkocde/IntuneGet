import { PGlite } from '@electric-sql/pglite';
import { auto_explain } from '@electric-sql/pglite/contrib/auto_explain';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';

const oldSql = readFileSync('supabase/migrations/20260911120000_release_history_filters.sql', 'utf8');
const newSql = readFileSync('supabase/migrations/20261113050036_catalog_history_indexed_app_filter.sql', 'utf8');
const boundedSql = readFileSync('supabase/migrations/20261113232318_catalog_history_page_bound_predecessors.sql', 'utf8');
const narrowSql = readFileSync('supabase/migrations/20261114051500_catalog_history_narrow_classification.sql', 'utf8');
const scopedSql = readFileSync('supabase/migrations/20261114111119_catalog_history_scope_branches.sql', 'utf8');
const restoredSql = readFileSync('supabase/migrations/20261114074820_restore_catalog_history_before_shared_stalls.sql', 'utf8');
let db: PGlite;
let originalAcl: unknown;
beforeAll(async () => {
  db = new PGlite({ extensions: { auto_explain } });
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.curated_apps(winget_id text PRIMARY KEY,name text,publisher text,is_locale_variant boolean);
    CREATE TABLE public.version_history(id bigserial PRIMARY KEY,winget_id text,version text NOT NULL,release_date text,created_at timestamptz,installers jsonb);
    CREATE INDEX idx_version_history_winget_id ON public.version_history(winget_id);
    CREATE TABLE public.curated_sync_status(id text,last_run_status text,last_run_completed_at timestamptz,last_successful_sync_at timestamptz);
    INSERT INTO public.curated_apps SELECT 'Fixture.'||g,'App '||g,'Publisher',false FROM generate_series(1,16484) g;
    INSERT INTO public.curated_apps VALUES ('fixture.1','Case variant','Publisher',false),('Locale.App','Locale','Publisher',true),(repeat('x',120),'Long app','Publisher',false);
    INSERT INTO public.version_history(winget_id,version,created_at,installers)
      SELECT a.winget_id,g::text,'2026-01-01'::timestamptz+g*interval '1 day','[{"Architecture":"x64"},{"Architecture":"arm64"}]'::jsonb
      FROM public.curated_apps a CROSS JOIN generate_series(1,32) g ORDER BY g, a.winget_id LIMIT 74832;
    INSERT INTO public.curated_apps VALUES ('Tied.App','Tied','Publisher',false),('Null.Date','Null date','Publisher',false),
      ('No.History','Empty','Publisher',false),('Null.Name',NULL,'Publisher',false),('Single.App','Single','Publisher',false),('Multi.Arch','Multi architecture','Publisher',false);
    INSERT INTO public.version_history(winget_id,version,created_at,installers) VALUES
      ('Tied.App','later','2026-02-03','[]'),('Tied.App','earlier','2026-02-01','[]'),
      ('Tied.App','same-time','2026-02-03','[]'),('Tied.App','undated',NULL,'[]'),
      ('Null.Date','undated',NULL,'[]'),('Null.Name','1','2026-02-03','[]'),('Single.App','1','2026-02-03','[]'),
      ('Multi.Arch','shared','2026-04-01','[{"Architecture":"x64"}]'),('Multi.Arch','shared','2026-04-02','[{"Architecture":"arm64"}]'),
      ('Multi.Arch','other','2026-04-03','[{"Architecture":"x64"}]'),('Multi.Arch','invalid','2026-04-04','{}');
    UPDATE public.version_history SET installers = jsonb_build_array(jsonb_build_object('Architecture', 'x64', 'Padding', repeat('p', 1500)), jsonb_build_object('Architecture', 'arm64')) WHERE winget_id <> 'Multi.Arch';
    ANALYZE public.curated_apps; ANALYZE public.version_history;
  `);
  await db.exec('VACUUM ANALYZE public.version_history');
  expect((await db.query<{ count: number }>('select count(*)::int as count from public.version_history')).rows[0].count).toBe(74843);
  expect((await db.query<{ count: number }>('select count(*)::int as count from public.curated_apps')).rows[0].count).toBe(16493);
  await db.exec(oldSql);
  await db.exec(oldSql.split('REVOKE ALL')[0].replace('public.get_catalog_release_history_v2(', 'pg_temp.catalog_before('));
  originalAcl = (await db.query("select proacl::text acl from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure")).rows[0];
  await db.exec(newSql);
  if (boundedSql.trim()) await db.exec(boundedSql);
  await db.exec(narrowSql);
  if (restoredSql.trim()) await db.exec(restoredSql);
  await db.exec(restoredSql.replace('public.get_catalog_release_history_v2(', 'pg_temp.catalog_restored('));
  if (scopedSql.trim()) await db.exec(scopedSql);
}, 60000);
afterAll(async () => { await db?.close(); });

const call = async (name: string, args: unknown[]) => (await db.query<{ result: unknown }>(
  `select ${name}($1::text,$2::text,$3::text,$4::integer,$5::text,$6::date,$7::date,$8::text) as result`, args,
)).rows[0].result;
it('preserves the complete prior JSON for app, case, locale, truncation, history and combined filters', async () => {
  const cases: unknown[][] = [
    ['', '', 'all', 1, 'fIxTuRe.1', null, null, ''],
    ['', '', 'all', 1, 'unknown', null, null, ''],
    ['', '', 'all', 1, 'Locale.App', null, null, ''],
    ['', '', 'all', 1, 'x'.repeat(120)+'suffix', null, null, ''],
    ['', '', 'first', 1, 'Fixture.1', null, null, ''],
    ['', '', 'updated', 1, 'Fixture.1', '2026-01-04', '2026-01-08', ''],
    ['', '2026-02', 'all', 1, 'Fixture.1', null, null, ''],
    ['', '', 'all', 2, 'Fixture.1', null, null, 'arm64'],
    ['App', '', 'all', 1, 'Fixture.1', null, null, 'x64'],
    ['', '', 'all', 1, '', null, null, ''],
    ['App 1', '', 'updated', 2, '', null, null, ''],
    ['', '', 'all', 1, null, null, null, ''],
    ...['Tied.App', 'Null.Date', 'No.History', 'Null.Name', 'Single.App'].flatMap(app =>
      ['all', 'first', 'updated'].map(kind => ['', '', kind, 1, app, null, null, ''])),
    ['', '', 'all', 1, 'Tied.App', '2026-02-03', null, ''],
    ['Tied', '2026-02', 'updated', 1, '', '2026-02-02', '2026-02-03', ''],
    ['not found', '', 'all', 1, '', null, null, ''],
    ['App', '', 'all', 1, 'Null.Name', null, null, ''],
    ...[null, 'unknown'].map(kind => ['', '', kind, 1, '', null, null, '']),
    ...[null, -2, 0, 50, 10001].map(page => ['', '', 'all', page, '', null, null, '']),
    ['', '', 'all', 1, 'Fixture.1', null, null, 'ARM64'],
    ['', '', 'all', 1, 'Multi.Arch', null, null, 'arm64'],
    ['', '2026-04', 'all', 1, '', null, null, 'arm64'],
  ];
  for (const args of cases) expect(await call('public.get_catalog_release_history_v2', args)).toEqual(await call('pg_temp.catalog_before', args));
}, 60000);

it('preserves the existing execution grants', async () => {
  expect((await db.query("select proacl::text acl from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure")).rows[0]).toEqual(originalAcl);
});


type PlanNode = Record<string, unknown> & { Plans?: PlanNode[] };
async function historyPlans(app: string, mode: string, name = 'public.get_catalog_release_history_v2') {
  await db.exec("LOAD 'auto_explain'; SET auto_explain.log_min_duration=0; SET auto_explain.log_nested_statements=on; SET auto_explain.log_analyze=on; SET auto_explain.log_buffers=on; SET auto_explain.log_timing=off; SET auto_explain.log_format='json'; SET auto_explain.log_level='notice'; SET plan_cache_mode=" + mode);
  const plans: PlanNode[] = [];
  await db.query("select " + name + "('','','all',1,$1,NULL,NULL,'')", [app], {
    onNotice: notice => {
      const offset = notice.message.indexOf('{');
      if (offset >= 0) {
        const plan = JSON.parse(notice.message.slice(offset)) as { Plan?: PlanNode };
        if (plan.Plan) plans.push(plan.Plan);
      }
    },
  });
  await db.exec('SET auto_explain.log_min_duration=-1');
  const nodes: PlanNode[] = [];
  const visit = (node: PlanNode) => { nodes.push(node); node.Plans?.forEach(visit); };
  plans.forEach(visit);
  expect(plans.length).toBeGreaterThan(1);
  return nodes.filter(node => node['Relation Name'] === 'version_history');
}

it('bounds actual global function work under generic and custom plans', async () => {
  for (const mode of ['force_generic_plan', 'force_custom_plan']) {
    const nodes = await historyPlans('', mode);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every(node => Number(node['Actual Loops']) <= 40)).toBe(true);
    expect(nodes.filter(node => Number(node['Actual Rows']) > 1000 && Number(node['Actual Loops']) === 1).length).toBeLessThanOrEqual(2);
    const buffers = nodes.reduce((sum, node) => sum + Number(node['Shared Hit Blocks'] ?? 0) + Number(node['Shared Read Blocks'] ?? 0), 0);
    const before = await historyPlans('', mode, 'pg_temp.catalog_restored');
    const beforeBuffers = before.reduce((sum, node) => sum + Number(node['Shared Hit Blocks'] ?? 0) + Number(node['Shared Read Blocks'] ?? 0), 0);
    expect(buffers).toBeLessThan(beforeBuffers);
  }
}, 60000);

it('keeps actual app function reads indexed under generic and custom plans', async () => {
  for (const mode of ['force_generic_plan', 'force_custom_plan']) {
    const nodes = await historyPlans('Fixture.1', mode);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.some(node => node['Node Type'] === 'Seq Scan' || node['Node Type'] === 'Hash Join')).toBe(false);
    const buffers = nodes.reduce((sum, node) => sum + Number(node['Shared Hit Blocks'] ?? 0) + Number(node['Shared Read Blocks'] ?? 0), 0);
    expect(buffers).toBeLessThanOrEqual(256);
  }
}, 60000);
