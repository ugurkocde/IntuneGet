import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';

const oldSql = readFileSync('supabase/migrations/20260911120000_release_history_filters.sql', 'utf8');
const newSql = readFileSync('supabase/migrations/20261113050036_catalog_history_indexed_app_filter.sql', 'utf8');
const boundedSql = readFileSync('supabase/migrations/20261113232318_catalog_history_page_bound_predecessors.sql', 'utf8');
let db: PGlite;
let originalAcl: unknown;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.curated_apps(winget_id text PRIMARY KEY,name text,publisher text,is_locale_variant boolean);
    CREATE TABLE public.version_history(id bigserial PRIMARY KEY,winget_id text,version text NOT NULL,release_date text,created_at timestamptz,installers jsonb);
    CREATE INDEX idx_version_history_winget_id ON public.version_history(winget_id);
    CREATE TABLE public.curated_sync_status(id text,last_run_status text,last_run_completed_at timestamptz,last_successful_sync_at timestamptz);
    INSERT INTO public.curated_apps SELECT 'Fixture.'||g,'App '||g,'Publisher',false FROM generate_series(1,512) g;
    INSERT INTO public.curated_apps VALUES ('fixture.1','Case variant','Publisher',false),('Locale.App','Locale','Publisher',true),(repeat('x',120),'Long app','Publisher',false);
    INSERT INTO public.version_history(winget_id,version,created_at,installers)
      SELECT a.winget_id,g::text,'2026-01-01'::timestamptz+g*interval '1 day','[{"Architecture":"x64"},{"Architecture":"arm64"}]'::jsonb
      FROM public.curated_apps a CROSS JOIN generate_series(1,32) g;
    INSERT INTO public.curated_apps VALUES ('Tied.App','Tied','Publisher',false),('Null.Date','Null date','Publisher',false),
      ('No.History','Empty','Publisher',false),('Null.Name',NULL,'Publisher',false),('Single.App','Single','Publisher',false);
    INSERT INTO public.version_history(winget_id,version,created_at,installers) VALUES
      ('Tied.App','later','2026-02-03','[]'),('Tied.App','earlier','2026-02-01','[]'),
      ('Tied.App','same-time','2026-02-03','[]'),('Tied.App','undated',NULL,'[]'),
      ('Null.Date','undated',NULL,'[]'),('Null.Name','1','2026-02-03','[]'),('Single.App','1','2026-02-03','[]');
    ANALYZE public.curated_apps; ANALYZE public.version_history;
  `);
  await db.exec(oldSql);
  await db.exec(oldSql.split('REVOKE ALL')[0].replace('public.get_catalog_release_history_v2(', 'pg_temp.catalog_before('));
  originalAcl = (await db.query("select proacl::text acl from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure")).rows[0];
  await db.exec(newSql);
  if (boundedSql.trim()) await db.exec(boundedSql);
}, 30000);
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
  ];
  for (const args of cases) expect(await call('public.get_catalog_release_history_v2', args)).toEqual(await call('pg_temp.catalog_before', args));
}, 30000);

it('uses the existing history index for the exact deployed per-app function body', async () => {
  const { rows } = await db.query<{ prosrc: string }>("select prosrc from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure");
  let body = rows[0].prosrc;
  const bindings: Record<string, string> = { app_filter: "'Fixture.1'", search_text: "''", month_filter: "''", kind_filter: "'all'", page_number: '1', date_from: 'NULL::date', date_to: 'NULL::date', architecture_filter: "''" };
  for (const [name, value] of Object.entries(bindings)) body = body.replace(new RegExp('\\b'+name+'\\b', 'g'), value);
  const plan = (await db.query('EXPLAIN (FORMAT JSON) '+body)).rows[0];
  const text = JSON.stringify(plan);
  expect(text).toContain('idx_version_history_winget_id');
  const scans: unknown[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const value = node as Record<string, unknown>;
    if (value['Node Type']==='Seq Scan' && value['Relation Name']==='version_history') scans.push(value);
    for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else if (typeof child==='object') visit(child);
  };
  visit(plan);
  expect(scans).toEqual([]);
  // SQL function bodies can also reuse generic parameterized plans.
  let genericBody = rows[0].prosrc;
  for (const [index, name] of ['search_text','month_filter','kind_filter','page_number','app_filter','date_from','date_to','architecture_filter'].entries()) genericBody = genericBody.replace(new RegExp('\\b'+name+'\\b', 'g'), '$'+(index+1));
  await db.exec('PREPARE history_generic(text,text,text,integer,text,date,date,text) AS '+genericBody);
  await db.exec('SET plan_cache_mode=force_generic_plan');
  const generic = (await db.query("EXPLAIN (FORMAT JSON) EXECUTE history_generic('','','all',1,'Fixture.1',NULL,NULL,'')")).rows[0];
  expect(JSON.stringify(generic)).toContain('idx_version_history_winget_id');
});

it('avoids a global history window and limits indexed predecessor reads to the returned page', async () => {
  const { rows } = await db.query<{ prosrc: string }>("select prosrc from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure");
  const names = ['search_text', 'month_filter', 'kind_filter', 'page_number', 'app_filter', 'date_from', 'date_to', 'architecture_filter'];
  let generic = rows[0].prosrc;
  names.forEach((name, index) => { generic = generic.replace(new RegExp('\\b' + name + '\\b', 'g'), '$' + (index + 1)); });
  await db.exec('PREPARE bounded_history(text,text,text,integer,text,date,date,text) AS ' + generic);
  const cases = [
    ["''", "''", "'all'", '1', "''", 'NULL::date', 'NULL::date', "''"],
    ["''", "''", "'updated'", '2', "''", 'NULL::date', 'NULL::date', "''"],
    ["''", "''", "'all'", '1', "'Fixture.1'", 'NULL::date', 'NULL::date', "''"],
  ];
  for (const mode of ['force_custom_plan', 'force_generic_plan']) {
    await db.exec('SET plan_cache_mode=' + mode);
    for (const args of cases) {
      let bound = rows[0].prosrc;
      names.forEach((name, index) => { bound = bound.replace(new RegExp('\\b' + name + '\\b', 'g'), args[index]); });
      const sql = mode === 'force_generic_plan' ? 'EXECUTE bounded_history(' + args.join(',') + ')' : bound;
      const plan = (await db.query('EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, FORMAT JSON) ' + sql)).rows;
      const nodes: Record<string, unknown>[] = [];
      const visit = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const value = node as Record<string, unknown>;
        if (value['Node Type']) nodes.push(value);
        for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else if (typeof child === 'object') visit(child);
      };
      visit(plan);
      expect(nodes.filter(n => n['Node Type'] === 'WindowAgg')).toEqual([]);
      const previous = nodes.find(n => n.Alias === 'prev_v');
      expect(previous).toBeDefined();
      expect(previous?.['Index Name']).toBe('idx_version_history_winget_id_created_at_id');
      expect(Number(previous?.['Actual Loops'])).toBeLessThanOrEqual(40);
      const first = nodes.find(n => n.Alias === 'first_v');
      expect(first?.['Index Name']).toBe('idx_version_history_winget_id_created_at_id');
      expect(Number(first?.['Actual Loops'])).toBeLessThanOrEqual(520);
    }
  }
}, 30000);

it('preserves the existing execution grants', async () => {
  expect((await db.query("select proacl::text acl from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure")).rows[0]).toEqual(originalAcl);
});
