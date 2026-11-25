"""Random global history pages select forty IDs without scanning skipped rows."""
import json
from pathlib import Path
import uuid
import concurrent.futures
import threading
import time

ROOT = Path(__file__).resolve().parents[2]


def contracts(sql):
    database = 'history_deep_' + uuid.uuid4().hex
    def run(q, role='fixture_owner'):
        return sql(q, database=database, role=role)
    def value(q):
        text = run(q).stdout.strip()
        if text in ('t', 'f'):
            return text == 't'
        return json.loads(text)
    def migration(name):
        return (ROOT / 'supabase/migrations' / name).read_text()
    def plan(rpc, page):
        result = run("load 'auto_explain';set auto_explain.log_min_duration=0;"
                     "set auto_explain.log_nested_statements=on;set auto_explain.log_analyze=on;"
                     "set auto_explain.log_buffers=on;set auto_explain.log_timing=off;"
                     "set auto_explain.log_format='json';set auto_explain.log_level='notice';"
                     "set work_mem='3500kB';set role fixture_owner;select public." + rpc + '(' +
                     ('page_number=>' if rpc.endswith('_v2') else '') + str(page) + ');', None)
        decoded = []
        decoder = json.JSONDecoder()
        position = 0
        while True:
            position = result.stderr.find('{', position)
            if position < 0:
                break
            try:
                item, size = decoder.raw_decode(result.stderr[position:])
                decoded.append(item); position += size
            except ValueError:
                position += 1
        def walk(x):
            if isinstance(x, dict):
                if 'Node Type' in x and x.get('Actual Loops', 0) > 0:
                    yield x
                for child in x.values():
                    yield from walk(child)
            elif isinstance(x, list):
                for child in x:
                    yield from walk(child)
        nodes = list(walk(decoded))
        assert nodes, 'Nested executed plan missing'
        return nodes
    def snapshot():
        return value("select json_agg(json_build_array(proname,proowner,proacl::text,proconfig,prosecdef,provolatile,prolang,proisstrict) order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in ('get_catalog_release_history_v2','get_catalog_release_history_global_rows')")
    sql('create database ' + database + ' owner fixture_owner', database='postgres', role=None)
    try:
        run("create table curated_apps(id serial unique,winget_id text primary key,name text,publisher text,is_locale_variant boolean);"
            "create table version_history(id serial primary key,winget_id text,version text,release_date text,created_at timestamptz,installers jsonb);"
            "create index idx_version_history_winget_id_created_at_id on version_history(winget_id,created_at,id);"
            "create index idx_version_history_observed on version_history(created_at desc,id desc);"
            "create table curated_sync_status(id text primary key,last_run_status text,last_run_completed_at timestamptz,last_successful_sync_at timestamptz);"
            "insert into curated_apps(winget_id,name,publisher,is_locale_variant) select 'Fixture.'||g,'Application '||g,'Publisher',false from generate_series(1,16500)g;"
            "insert into version_history(winget_id,version,created_at,installers) select 'Fixture.'||((g-1)%16500+1),g::text,'2026-01-01'::timestamptz+(g/2)*interval '1 minute','[]' from generate_series(1,95013)g;"
            "insert into curated_apps(winget_id,name,publisher,is_locale_variant) values('Locale.App','Locale','Publisher',true);"
            "insert into version_history(winget_id,version,created_at) values('Locale.App','excluded',now()),('Fixture.1','undated',NULL);"
            "analyze curated_apps;analyze version_history;")
        for filename in ['20261115083235_catalog_history_global_page_plan.sql', '20261125033000_catalog_history_single_global_aggregate.sql', '20261115133712_catalog_history_global_rows.sql']:
            run('begin;' + migration(filename) + 'commit;')
        security = snapshot()
        old = value("select to_json(pg_get_functiondef('public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure))")
        oldrows = value("select to_json(pg_get_functiondef('public.get_catalog_release_history_global_rows(integer)'::regprocedure))")
        run(old.replace('public.get_catalog_release_history_v2(', 'public.history_deep_oracle(', 1))
        expected = value('select public.get_catalog_release_history_v2(page_number=>1911)')
        assert len(expected['rows']) == 40 and expected['total'] == 95013
        def history_work(nodes):
            return sum(n['Actual Rows']*n['Actual Loops'] for n in nodes if n.get('Relation Name')=='version_history')
        shallow = {(rpc,page): history_work(plan(rpc,page)) for rpc in ['get_catalog_release_history_v2','get_catalog_release_history_global_rows'] for page in [1,2,3,20,100]}
        for rpc in ['get_catalog_release_history_v2', 'get_catalog_release_history_global_rows']:
            before = plan(rpc, 1911)
            assert any(n['Node Type'] in ('Sort', 'Index Scan', 'Index Only Scan') and n['Actual Rows'] >= 76400 for n in before), 'OLD skipped-row work not reproduced'
            try:
                assert not any(n['Node Type'] == 'Limit' and any(c.get('Actual Rows', 0) >= 76400 for c in n.get('Plans', [])) for n in before)
            except AssertionError:
                print('RED ' + rpc + ': page 1911 Limit consumes skipped rows', flush=True)
            else:
                raise AssertionError('Regression assertion unexpectedly passed on OLD')
        candidate = migration('20261125124000_catalog_history_deep_page_lookup.sql')
        # Guards must accept committed LF and live CRLF predecessor definitions.
        run('begin;' + candidate + 'rollback;')
        run(old.replace('\n', '\r\n') + ';\n' + oldrows.replace('\n', '\r\n') + ';')
        run('begin;' + candidate + 'commit;')
        assert snapshot() == security, 'Owner/ACL/function security changed'
        assert value('select public.get_catalog_release_history_v2(page_number=>1911)') == expected
        for page in ['NULL', '-5', '0', '1', '2', '100', '101', '1324', '1911', '2376', '2377', '10000', '10001']:
            assert value('select public.get_catalog_release_history_v2(page_number=>' + page + ')=public.history_deep_oracle(page_number=>' + page + ')') is True
            assert value("select public.get_catalog_release_history_global_rows(" + page + ")=(public.history_deep_oracle(page_number=>" + page + ")->'rows')") is True
        for args in ["kind_filter=>'updated',page_number=>2", "app_filter=>'Fixture.1'", "search_text=>'Application 1',page_number=>2", "month_filter=>'2026-01',page_number=>2", "date_from=>'2026-01-10',date_to=>'2026-01-12'", "architecture_filter=>'x64'"]:
            assert value('select public.get_catalog_release_history_v2(' + args + ')=public.history_deep_oracle(' + args + ')') is True
        temp_spills = []
        for rpc in ['get_catalog_release_history_v2', 'get_catalog_release_history_global_rows']:
            for page in [1,2,3,20,100]:
                assert history_work(plan(rpc,page)) <= shallow[(rpc,page)], 'Shallow page history work regressed'
            blocks = {}
            for page in [1324, 1911]:
                after = plan(rpc, page)
                if any(n.get('Temp Read Blocks', 0) or n.get('Temp Written Blocks', 0) for n in after):
                    temp_spills.append((rpc, page))
                assert not any(n['Node Type']=='Limit' and any(c.get('Actual Rows',0)>=76400 for c in n.get('Plans',[])) for n in after), 'Still scans skipped rows'
                assert any(n.get('CTE Name')=='page_ids' and n['Actual Rows']<=40 for n in after), 'Unbounded page assembly'
                assert any(n.get('Index Name')=='version_history_pkey' and n['Actual Loops']==40 for n in after), 'Page does not use forty PK lookups'
                assert sum(n['Node Type']=='Seq Scan' and n.get('Relation Name')=='version_history' for n in after)==1, 'Expected one history scan'
                blocks[page] = sum(after[0].get(k, 0) for k in ['Shared Hit Blocks', 'Shared Read Blocks', 'Temp Read Blocks', 'Temp Written Blocks'])
            assert blocks[1911] <= blocks[1324] * 1.1, 'Deep page block work grows with page depth'
            print('GREEN ' + rpc + ': unchanged shallow work; one history scan and forty indexed rows at deep pages', flush=True)
        assert not temp_spills, 'Deep paths spill temporary I/O: ' + json.dumps(temp_spills)
        for rpc in ['get_catalog_release_history_v2', 'get_catalog_release_history_global_rows']:
            for page in [101,2376,2377]:
                nodes = plan(rpc,page)
                assert not any(n.get('Temp Read Blocks',0) or n.get('Temp Written Blocks',0) or n.get('Sort Space Type')=='Disk' for n in nodes), (rpc,page)
        barrier = threading.Barrier(8)
        def concurrent_call(i):
            page = [1,2,3,100,101,1324,1730,1911][i]
            rpc = 'get_catalog_release_history_v2' if i%2==0 else 'get_catalog_release_history_global_rows'
            barrier.wait(timeout=10)
            start = time.monotonic()
            run("set statement_timeout='3s';select public."+rpc+'('+('page_number=>' if rpc.endswith('_v2') else '')+str(page)+');')
            return (time.monotonic()-start)*1000
        with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
            calls = [pool.submit(concurrent_call,i) for i in range(8)]
            start = time.monotonic()
            pool.submit(run,"select winget_id from public.curated_apps where winget_id='Fixture.1'").result(timeout=10)
            unrelated = (time.monotonic()-start)*1000
            timings = [c.result(timeout=10) for c in calls]
        assert max(timings)<2000 and unrelated<1000, (timings,unrelated)
        print('PASS replacement eight sessions '+json.dumps({'p95_ms':max(timings),'unrelated_ms':unrelated}), flush=True)
        # A bulk sync timestamp can straddle either page edge. Locale and orphan
        # rows in the same timestamp range must not affect the rank bounds.
        run("insert into version_history(winget_id,version,created_at) select 'Fixture.1','tie-'||g,'2026-02-02' from generate_series(1,20000)g;"
            "insert into version_history(winget_id,version,created_at) values('Locale.App','tie-locale','2026-02-02'),('Missing.App','tie-orphan','2026-02-02');analyze version_history;")
        above = value("select count(*) from version_history v join curated_apps c using(winget_id) where c.is_locale_variant is not true and v.created_at>'2026-02-02'")
        tie_pages = sorted(set([max(101,above//40+1),max(101,(above+20000)//40+1),150,300]))
        for page in tie_pages:
            assert value('select public.get_catalog_release_history_v2(page_number=>'+str(page)+')=public.history_deep_oracle(page_number=>'+str(page)+')') is True
            assert value("select public.get_catalog_release_history_global_rows("+str(page)+")=(public.history_deep_oracle(page_number=>"+str(page)+")->'rows')") is True
            for rpc in ['get_catalog_release_history_v2','get_catalog_release_history_global_rows']:
                assert not any(n.get('Temp Read Blocks',0) or n.get('Temp Written Blocks',0) for n in plan(rpc,page)), (rpc,page,'tie spill')
        run("insert into version_history(winget_id,version,created_at) values('Fixture.1','positive-infinity','infinity'),('Fixture.1','negative-infinity','-infinity'),('Fixture.1','wide-year','10000-01-01'),('Fixture.1','bc-year','0001-01-01 BC');analyze version_history;")
        for page in [101,1324,1911]:
            assert value('select public.get_catalog_release_history_v2(page_number=>'+str(page)+')=public.history_deep_oracle(page_number=>'+str(page)+')') is True
        assert snapshot()==security
        print('PASS 20000 timestamp ties, locale/orphan exclusion, infinity and wide-year metadata parity',flush=True)
        run('truncate version_history')
        assert value("select public.get_catalog_release_history_v2()->'rows'") == []
        assert value('select public.get_catalog_release_history_global_rows(1911)') == []
        print('PASS 95013 visible rows, tie ordering, locale/null exclusion, all edge pages, both RPCs, filters, ACL and empty catalog', flush=True)
    finally:
        sql('drop database ' + database + ' with (force)', database='postgres', role=None)
