import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';

const oldSql = readFileSync('supabase/migrations/20260911120000_release_history_filters.sql', 'utf8');
const newSql = readFileSync('supabase/migrations/20261113050036_catalog_history_indexed_app_filter.sql', 'utf8');
const boundedSql = readFileSync('supabase/migrations/20261113232318_catalog_history_page_bound_predecessors.sql', 'utf8');
const narrowSql = readFileSync('supabase/migrations/20261114051500_catalog_history_narrow_classification.sql', 'utf8');
let db: PGlite;
let originalAcl: unknown;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.curated_apps(winget_id text PRIMARY KEY,name text,publisher text,is_locale_variant boolean);
    CREATE TABLE public.version_history(id serial PRIMARY KEY,winget_id text,version text NOT NULL,release_date text,created_at timestamptz,installers jsonb,UNIQUE(winget_id,version));
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
      ('Tied.App','same-first-time','2026-02-01','[]'),
      ('Tied.App','same-time','2026-02-03','[]'),('Tied.App','undated',NULL,'[]'),
      ('Null.Date','undated',NULL,'[]'),('Null.Name','1','2026-02-03','[]'),('Single.App','1','2026-02-03','[]');
    ANALYZE public.curated_apps; ANALYZE public.version_history;
  `);
  await db.exec(oldSql);
  await db.exec(oldSql.split('REVOKE ALL')[0].replace('public.get_catalog_release_history_v2(', 'pg_temp.catalog_before('));
  originalAcl = (await db.query("select proacl::text acl from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure")).rows[0];
  await db.exec(newSql);
  if (boundedSql.trim()) await db.exec(boundedSql);
  await db.exec(narrowSql);
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
      expect(nodes.filter(n => n['Relation Name'] === 'version_history')
        .every(n => Number(n['Actual Loops']) <= 40)).toBe(true);
    }
  }
}, 30000);

it('preserves the existing execution grants', async () => {
  expect((await db.query("select proacl::text acl from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure")).rows[0]).toEqual(originalAcl);
});

it('bounds history reads and spill at production scale without changing either failing response', async () => {
  const scale = new PGlite();
  try {
    await scale.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.curated_apps(winget_id text PRIMARY KEY,name text,publisher text,is_locale_variant boolean);
      CREATE TABLE public.version_history(id serial PRIMARY KEY,winget_id text,version text NOT NULL,release_date text,created_at timestamptz,installers jsonb,UNIQUE(winget_id,version));
      CREATE INDEX idx_version_history_winget_id ON public.version_history(winget_id);
      CREATE TABLE public.curated_sync_status(id text,last_run_status text,last_run_completed_at timestamptz,last_successful_sync_at timestamptz);
      INSERT INTO public.curated_apps SELECT 'Fixture.Publisher.Product.'||lpad(g::text,5,'0'),'Fixture application '||g,'Fixture Publisher',false FROM generate_series(1,16415) g;
      INSERT INTO public.curated_apps SELECT 'Fixture.Locale.Product.'||g,'Locale application '||g,'Fixture Publisher',true FROM generate_series(1,78) g;
      INSERT INTO public.version_history(winget_id,version,release_date,created_at,installers)
        SELECT a.winget_id,v::text,'2026-01-01',TIMESTAMPTZ '2026-01-01'+((row_number() OVER (ORDER BY a.winget_id,v))%325)*INTERVAL '1 day','[{"Architecture":"x64"}]'::jsonb
        FROM public.curated_apps a CROSS JOIN generate_series(1,4) v;
      INSERT INTO public.version_history(winget_id,version,release_date,created_at,installers)
        SELECT winget_id,'5','2026-01-01',TIMESTAMPTZ '2026-11-10','[{"Architecture":"x64"}]'::jsonb FROM public.curated_apps WHERE is_locale_variant=false ORDER BY winget_id LIMIT 8871;
      SET work_mem='4MB';
    `);
    await scale.exec(oldSql);
    await scale.exec(boundedSql);
    await scale.exec(boundedSql.replace('public.get_catalog_release_history_v2(', 'pg_temp.catalog_deployed('));
    await scale.exec(narrowSql);
    await scale.exec('VACUUM ANALYZE public.version_history;');
    await scale.exec('ANALYZE public.curated_apps;');
    const source = (await scale.query<{prosrc:string}>("select prosrc from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure")).rows[0].prosrc;
    const names = ['search_text','month_filter','kind_filter','page_number','app_filter','date_from','date_to','architecture_filter'];
    let generic = source;
    names.forEach((name,index)=>{generic=generic.replace(new RegExp('\\b'+name+'\\b','g'),'$'+(index+1));});
    await scale.exec('PREPARE scale_history(text,text,text,integer,text,date,date,text) AS '+generic);
    for (const args of [ ['', '', 'all', 1, '', null, null, ''], ['', '', 'updated', 1, '', '2026-11-08', null, ''] ]) {
      const query = (name:string) => scale.query<{result:unknown}>(`select ${name}($1::text,$2::text,$3::text,$4::integer,$5::text,$6::date,$7::date,$8::text) result`,args);
      expect((await query('public.get_catalog_release_history_v2')).rows[0].result).toEqual((await query('pg_temp.catalog_deployed')).rows[0].result);
      const literals = args.map((value,index)=>value===null?'NULL::date':typeof value==='number'?String(value):"'"+value+"'"+(index===5||index===6?'::date':''));
      for (const mode of ['force_custom_plan','force_generic_plan']) {
        await scale.exec('SET plan_cache_mode='+mode);
        let bound=source;
        names.forEach((name,index)=>{bound=bound.replace(new RegExp('\\b'+name+'\\b','g'),literals[index]);});
        const sql=mode==='force_generic_plan'?'EXECUTE scale_history('+literals.join(',')+')':bound;
        const plan=(await scale.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql)).rows;
        const nodes:Record<string,unknown>[]=[];
        const visit=(node:unknown)=>{if(!node||typeof node!=='object')return;const value=node as Record<string,unknown>;if(value['Node Type'])nodes.push(value);for(const child of Object.values(value))if(Array.isArray(child))child.forEach(visit);else if(typeof child==='object')visit(child);};
        visit(plan);
        expect(nodes.filter(n=>n['Node Type']==='WindowAgg')).toEqual([]);
        // Constant bulk passes replace per-app probes without hiding repeated CTE or subplan work.
        expect(nodes.every(n=>Number(n['Actual Loops'])<=40)).toBe(true);
        const historyNodes=nodes.filter(n=>n['Relation Name']==='version_history');
        expect(historyNodes.filter(n=>Number(n['Actual Loops'])>1).length).toBeLessThanOrEqual(2);
        expect(historyNodes.filter(n=>Number(n['Actual Loops'])===1).length).toBeLessThanOrEqual(5);
        expect(nodes.find(n=>n['Parent Relationship']===undefined)?.['Temp Written Blocks']).toBe(0);
      }
      const elapsed:number[]=[];
      for(let n=0;n<20;n++){const started=performance.now();await query('public.get_catalog_release_history_v2');elapsed.push(performance.now()-started);}
      elapsed.sort((a,b)=>a-b);
      console.info('History fixture timing',JSON.stringify({kind:args[2],from:args[5],samples:20,p95Ms:elapsed[18]}));
    }
  } finally { await scale.close(); }
}, 120000);
