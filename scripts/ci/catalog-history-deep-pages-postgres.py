"""Random global history pages select forty IDs without scanning skipped rows."""
import json
import re
from pathlib import Path
import uuid
import concurrent.futures
import threading
import time
import subprocess

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


def metadata_bounds_cache_contracts(provided_sql, command, env):
    """Cache hits reduce repeated history work while preserving invoker, transaction and live fallback contracts."""
    database = 'history_metadata_' + uuid.uuid4().hex
    db = database
    sessions = []
    checks = []

    def sql(text, role='fixture_owner', database=database, fail=False):
        return provided_sql(text, role=role, database=database, check=not fail)

    def value(q, role='fixture_owner'):
        text = sql(q, role).stdout.strip()
        return text == 't' if text in ['t', 'f'] else json.loads(text)

    def session():
        s = subprocess.Popen(command(database=db), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1, env=env, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        sessions.append(s)
        send(s, "set statement_timeout='10s';set lock_timeout='5s';set role fixture_owner;")
        return s

    def send(s, q):
        s.stdin.write(q + '\n')
        s.stdin.flush()

    def line(s):
        r = s.stdout.readline().strip()
        if not r:
            raise RuntimeError('Session missing output')
        return r

    def close(s):
        send(s, 'rollback;')
        s.stdin.close()
        s.wait(timeout=5)

    def parity(page=101, session_=None):
        q = 'select json_build_array(public.get_catalog_release_history_v2(page_number=>' + str(page) + ')=public.oracle_v2(page_number=>' + str(page) + '),public.get_catalog_release_history_global_rows(' + str(page) + ')=(public.oracle_v2(page_number=>' + str(page) + ")->'rows'));"
        actual = value(q) if session_ is None else send(session_, q) or json.loads(line(session_))
        assert actual == [True, True], ('RPC parity', page, actual)

    def plan(rpc, page):
        q = "load 'auto_explain';set auto_explain.log_min_duration=0;set auto_explain.log_nested_statements=on;set auto_explain.log_analyze=on;set auto_explain.log_buffers=on;set auto_explain.log_timing=off;set auto_explain.log_format='json';set auto_explain.log_level='notice';set work_mem='3500kB';set role fixture_owner;select public." + rpc + '(' + ('page_number=>' if rpc.endswith('_v2') else '') + str(page) + ');'
        r = sql(q, None)
        decoder = json.JSONDecoder()
        position = 0
        decoded = []
        while True:
            position = r.stderr.find('{', position)
            if position < 0:
                break
            try:
                item, size = decoder.raw_decode(r.stderr[position:])
                decoded.append(item)
                position += size
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
        assert nodes, 'No nested plan evidence'
        return nodes

    def work(nodes):
        return sum((n['Actual Rows'] * n['Actual Loops'] for n in nodes if n.get('Relation Name') == 'version_history'))

    def refresh():
        assert sql('select public.refresh_catalog_release_history_cache()').stdout.strip() == 't'

    def restore():
        sql('truncate public.version_history,public.curated_apps;insert into public.curated_apps select * from public.apps_backup;insert into public.version_history select * from public.history_backup;')
        refresh()
        assert sql('select catalog_internal.history_cache_is_usable()').stdout.strip() == 't'
    try:
        for role in ['anon', 'authenticated', 'service_role']:
            sql("do $$begin if not exists(select 1 from pg_roles where rolname='" + role + "') then create role " + role + ';end if;end$$;', None, 'postgres')
        sql('create database ' + db + ' owner fixture_owner', None, 'postgres')
        sql("create table curated_apps(id serial unique,winget_id text primary key,name text,publisher text,is_locale_variant boolean);\n     create table version_history(id serial primary key,winget_id text,version text,release_date text,created_at timestamptz,installers jsonb);\n     create index idx_version_history_winget_id_created_at_id on version_history(winget_id,created_at,id);\n     create index idx_version_history_observed on version_history(created_at desc,id desc);\n     create table curated_sync_status(id text primary key,last_run_status text,last_run_completed_at timestamptz,last_successful_sync_at timestamptz);\n     insert into curated_apps(winget_id,name,publisher,is_locale_variant) select 'Fixture.'||g,'Application '||g,'Publisher',false from generate_series(1,16500)g;\n     insert into version_history(winget_id,version,created_at,installers) select 'Fixture.'||((g-1)%16500+1),g::text,'2026-01-01'::timestamptz+(g/2)*interval '1 minute','[]' from generate_series(1,95013)g;\n     insert into curated_apps(winget_id,name,is_locale_variant) values('Locale.App','Locale',true);\n     insert into version_history(winget_id,version,created_at) values('Locale.App','excluded',now()),('Fixture.1','undated',null);\n     insert into curated_sync_status values('sync-manifests','success','2026-11-26','2026-11-26');\n     analyze curated_apps;analyze version_history;")
        for name in ['20261115083235_catalog_history_global_page_plan.sql', '20261125033000_catalog_history_single_global_aggregate.sql', '20261115133712_catalog_history_global_rows.sql', '20261125124000_catalog_history_deep_page_lookup.sql']:
            sql('begin;' + (ROOT / 'supabase/migrations' / name).read_text() + 'commit;')
        definition = value("select to_json(pg_get_functiondef('public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure))")
        rows_definition = value("select to_json(pg_get_functiondef('public.get_catalog_release_history_global_rows(integer)'::regprocedure))")
        security_query = "select json_agg(json_build_array(proname,proowner,proacl::text,proconfig,prosecdef,provolatile,prolang,proisstrict) order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in ('get_catalog_release_history_v2','get_catalog_release_history_global_rows')"
        security = value(security_query)
        sql(definition.replace('public.get_catalog_release_history_v2(', 'public.oracle_v2(', 1))
        before = work(plan('get_catalog_release_history_v2', 1911))
        assert before >= 95013
        checks.append({'name': 'Current V2 full-history scan on deep page', 'verdict': 'RED', 'historyRowsVisited': before})
        print('RED current full-history work ' + str(before), flush=True)
        candidate = (ROOT / 'supabase/migrations/20261126220806_catalog_history_metadata_bounds_cache.sql').read_text()
        sql('begin;' + candidate + 'rollback;')
        assert value(security_query) == security
        sql('begin;' + candidate + 'commit;')
        assert value(security_query) == security
        parity()
        checks.append({'name': 'Empty cache exact fallback', 'verdict': 'PASS'})
        predecessor_definition = value("select to_json(pg_get_functiondef('public.refresh_catalog_release_history_cache()'::regprocedure))")
        refresh_security_query = "select json_build_array(proowner,proacl::text,proconfig,prosecdef,provolatile,prolang,proisstrict) from pg_proc where oid='public.refresh_catalog_release_history_cache()'::regprocedure"
        refresh_security = value(refresh_security_query)
        for correction in sorted((ROOT / 'supabase/migrations').glob('*_catalog_history_refresh_safeupdate.sql')):
            migration_sql = correction.read_text()
            for newline_definition in [predecessor_definition, predecessor_definition.replace('\n', '\r\n')]:
                sql('begin;' + newline_definition + ';' + migration_sql + 'rollback;')
                assert value(refresh_security_query) == refresh_security
            changed = predecessor_definition.replace('RETURN true;', 'RETURN false;')
            denied = sql('begin;' + changed + ';' + migration_sql + 'rollback;', fail=True)
            assert denied.returncode and 'Unexpected catalog history refresh predecessor' in denied.stderr
            denied = sql('begin;alter function public.refresh_catalog_release_history_cache() strict;' + migration_sql + 'rollback;', fail=True)
            assert denied.returncode and 'Unexpected catalog history refresh predecessor' in denied.stderr
            sql('begin;' + correction.read_text() + 'commit;')
            assert value(refresh_security_query) == refresh_security
            checks.append({'name': 'Refresh migration LF/CRLF replay, changed-body/STRICT denials and security parity', 'verdict': 'PASS'})
        for optimization in sorted((ROOT / 'supabase/migrations').glob('*_catalog_history_refresh_setbased.sql')):
            pre_setbased_definition = value("select to_json(pg_get_functiondef('public.refresh_catalog_release_history_cache()'::regprocedure))")
            assert 'width_bucket' in pre_setbased_definition
            t0 = time.monotonic()
            refresh()
            pre_ms = round((time.monotonic() - t0) * 1000, 1)
            expected_meta = value('select json_build_array(total,apps,months,coverage_start) from catalog_internal.catalog_release_history_meta where id=1')
            expected_bounds = value('select json_agg(json_build_array(page_number,hi,lo,tie_skip) order by page_number) from catalog_internal.catalog_release_history_page_bounds')
            migration_sql = optimization.read_text()
            for newline_definition in [pre_setbased_definition, pre_setbased_definition.replace('\n', '\r\n')]:
                sql('begin;' + newline_definition + ';' + migration_sql + 'rollback;')
                assert value(refresh_security_query) == refresh_security
            changed = pre_setbased_definition.replace('RETURN true;', 'RETURN false;')
            denied = sql('begin;' + changed + ';' + migration_sql + 'rollback;', fail=True)
            assert denied.returncode and 'Unexpected catalog history refresh predecessor' in denied.stderr
            denied = sql('begin;alter function public.refresh_catalog_release_history_cache() strict;' + migration_sql + 'rollback;', fail=True)
            assert denied.returncode and 'Unexpected catalog history refresh predecessor' in denied.stderr
            sql('begin;' + migration_sql + 'commit;')
            assert value(refresh_security_query) == refresh_security
            post_setbased_definition = value("select to_json(pg_get_functiondef('public.refresh_catalog_release_history_cache()'::regprocedure))")
            assert 'width_bucket' not in post_setbased_definition
            sql('delete from catalog_internal.catalog_release_history_meta where id=1;')
            t1 = time.monotonic()
            refresh()
            post_ms = round((time.monotonic() - t1) * 1000, 1)
            actual_meta = value('select json_build_array(total,apps,months,coverage_start) from catalog_internal.catalog_release_history_meta where id=1')
            actual_bounds = value('select json_agg(json_build_array(page_number,hi,lo,tie_skip) order by page_number) from catalog_internal.catalog_release_history_page_bounds')
            assert actual_meta == expected_meta, ('Meta mismatch', actual_meta, expected_meta)
            assert actual_bounds == expected_bounds, 'Page bounds mismatch against predecessor'
            print(f'GREEN set-based refresh parity PASS (predecessor={pre_ms}ms, setbased={post_ms}ms, pages={len(actual_bounds)})', flush=True)
            checks.append({'name': 'Set-based refresh migration parity, LF/CRLF replay, denials and security parity', 'verdict': 'PASS', 'predecessorMs': pre_ms, 'setbasedMs': post_ms, 'pages': len(actual_bounds)})
            sql('delete from catalog_internal.catalog_release_history_meta where id=1;')
        # SIMULATED safeupdate boundary: local PG distributions need not ship the
        # extension. Reproduce its WHERE-clause rejection inside the executed
        # refresh, without claiming that this is a real extension runtime test.
        refresh_definition = value("select to_json(pg_get_functiondef('public.refresh_catalog_release_history_cache()'::regprocedure))")
        def guard_delete(match):
            statement = match.group(0)
            if re.search(r'\bWHERE\b', statement, re.I):
                return statement
            return "RAISE EXCEPTION 'DELETE requires a WHERE clause' USING ERRCODE='21000';"
        guarded = re.sub(r'\bDELETE\s+FROM\s+[^;]+;', guard_delete, refresh_definition, flags=re.I)
        sql(guarded)
        refresh()
        # Seed every legal key range, including out-of-range keys: the bounds
        # table has a non-null primary key but no positive-page CHECK.
        sql("insert into catalog_internal.catalog_release_history_page_bounds values(-1,now(),now(),0),(10001,now(),now(),0);"
            "insert into version_history(winget_id,version,created_at)values('Fixture.1','safeupdate-refresh','2027-01-01');")
        refresh()
        assert value('select count(*) from catalog_internal.catalog_release_history_page_bounds where page_number<1 or page_number>10000') == 0
        assert value('select count(*) from catalog_internal.catalog_release_history_invalidation') == 0
        parity(1)
        parity(101)
        sql('create table safeupdate_history_backup as table version_history;delete from version_history where id>100;')
        refresh()
        assert value('select count(*) from catalog_internal.catalog_release_history_page_bounds') == 3
        parity(1)
        parity(101)
        sql('delete from version_history where id is not null;')
        refresh()
        assert value('select count(*) from catalog_internal.catalog_release_history_page_bounds') == 0
        assert value('select total from catalog_internal.catalog_release_history_meta') == 0
        parity(1)
        parity(101)
        sql('insert into version_history select * from safeupdate_history_backup;drop table safeupdate_history_backup;')
        refresh()
        checks.append({'name': 'SIMULATED guarded shrink and empty rebuild remove stale pages with full RPC parity', 'verdict': 'PASS'})
        checks.append({'name': 'SIMULATED safeupdate refresh clears all bounds and invalidations with full RPC parity', 'verdict': 'PASS', 'realExtensionRuntime': 'NOT_RUN_UNAVAILABLE'})
        sql(refresh_definition)
        assert sql('select public.refresh_catalog_release_history_cache()').stdout.strip() == 'f'
        for page in [1, 100, 101, 1324, 1911, 2376, 2377, 10000]:
            parity(page)
            for rpc in ['get_catalog_release_history_v2', 'get_catalog_release_history_global_rows']:
                if rpc.endswith('_global_rows') and page <= 100:
                    continue
                nodes = plan(rpc, page)
                visited = work(nodes)
                bound = page * 40 + 100 if page <= 100 else 500
                assert visited <= bound, (rpc, page, visited, bound)
                assert not any((n.get('Temp Read Blocks', 0) or n.get('Temp Written Blocks', 0) for n in nodes))
                checks.append({'name': rpc + ' page ' + str(page), 'verdict': 'GREEN', 'historyRowsVisited': visited})
        for args in ["kind_filter=>'updated',page_number=>2", "app_filter=>'Fixture.1'", "search_text=>'Application 1',page_number=>2", "month_filter=>'2026-01',page_number=>2", "date_from=>'2026-01-10',date_to=>'2026-01-12'", "architecture_filter=>'x64'"]:
            assert value('select public.get_catalog_release_history_v2(' + args + ')=public.oracle_v2(' + args + ')') is True
        checks.append({'name': 'Filtered branch parity', 'verdict': 'PASS'})
        sql('create table apps_backup as table curated_apps;create table history_backup as table version_history;')
        sql("update curated_apps set name=name||' updated';update version_history set release_date='2026-11-26' where id=(select max(id) from version_history);")
        assert value('select catalog_internal.history_cache_is_usable()') is True
        parity(1)
        sql("update curated_apps set is_locale_variant=true where winget_id='Fixture.1';")
        assert value('select catalog_internal.history_cache_is_usable()') is False
        parity()
        restore()
        checks.append({'name': 'Nonstructural fields remain live; locale membership invalidates', 'verdict': 'PASS'})
        # Conflict updates and empty inserts must not discard correct rank metadata.
        for query in [
            "insert into curated_apps(winget_id,name,is_locale_variant) values('Fixture.1','renamed',false) on conflict(winget_id) do update set name=excluded.name",
            "insert into version_history(id,winget_id,version,created_at) select id,winget_id,version,created_at from version_history where id=1 on conflict(id) do update set version=excluded.version",
            "insert into curated_apps(winget_id) select 'Empty.App' where false",
        ]:
            sql(query)
            assert value('select catalog_internal.history_cache_is_usable()') is True, 'No-op upsert invalidated valid history cache'
            assert sql('select public.refresh_catalog_release_history_cache()').stdout.strip() == 'f'
            parity()
        sql("insert into curated_apps(winget_id,is_locale_variant) values('Fixture.1',true) on conflict(winget_id) do update set is_locale_variant=excluded.is_locale_variant")
        assert value('select catalog_internal.history_cache_is_usable()') is False
        parity()
        restore()
        checks.append({'name': 'Conflict-only and zero-row inserts preserve cache; structural upsert invalidates', 'verdict': 'PASS'})

        for page in ['NULL', -5, 0, 2, 10001]:
            parity(page)
        sql("insert into version_history(winget_id,version,created_at) select 'Fixture.1','tie-'||g,'2026-02-02' from generate_series(1,20000) g;insert into version_history(winget_id,version,created_at) values('Locale.App','tie-locale','2026-02-02'),('Missing.App','tie-orphan','2026-02-02'),('Fixture.1','infinity','infinity'),('Fixture.1','negative-infinity','-infinity'),('Fixture.1','wide','10000-01-01'),('Fixture.1','bc','0001-01-01 BC');")
        refresh()
        for page in [101, 150, 300, 1324, 1911]:
            parity(page)
        checks.append({'name': 'Clamped pages, timestamp ties, locale/orphan exclusions and wide dates', 'verdict': 'PASS'})
        for case_name, case_rows in [
            ('infinity_without_neg_infinity', "('Fixture.1','inf-only','infinity'),('Fixture.1','fin-1','2026-01-15+00')"),
            ('neg_infinity_only', "('Fixture.1','ninf-only','-infinity')"),
            ('same_page_ad_bc_era_span', "('Fixture.1','ad-jan','0001-01-15+00'),('Fixture.1','bc-dec','0001-12-01+00 BC'),('Fixture.1','bc-jan','0001-01-01+00 BC')"),
        ]:
            sql('truncate public.version_history;insert into public.version_history(winget_id,version,created_at) values' + case_rows + ';')
            refresh()
            parity(1)
        checks.append({'name': 'Single-sided non-finite timestamps and same-page AD/BC era span parity', 'verdict': 'PASS'})
        restore()
        a = session()
        send(a, 'begin;select pg_current_xact_id()::text;')
        assert line(a).isdigit()
        sql("insert into version_history(winget_id,version,created_at)values('Fixture.1','advance-snapshot-horizon','2027-01-02')")
        send(a, "do $$begin perform public.refresh_catalog_release_history_cache();raise exception 'Assigned-XID refresh unexpectedly accepted';exception when others then if sqlerrm<>'Catalog history cache refresh requires an unassigned transaction' then raise;end if;end$$;select 'guarded';")
        assert line(a) == 'guarded'
        send(a, "insert into version_history(winget_id,version,created_at)values('Fixture.1','write-after-rejected-refresh','2027-01-03');commit;select 'committed';")
        assert line(a) == 'committed'
        a.stdin.close()
        a.wait(timeout=5)
        parity()
        refresh()
        checks.append({'name': 'Assigned XID refresh rejected across newer transaction and later own write', 'verdict': 'PASS'})
        a = session()
        send(a, "begin;insert into version_history(winget_id,version,created_at)values('Fixture.1','writer-a','2027-01-01');select 'writer-ready';")
        assert line(a) == 'writer-ready'
        sql("insert into version_history(winget_id,version,created_at)values('Fixture.1','writer-b','2027-01-02')")
        refresh()
        send(a, "commit;select 'writer-done';")
        assert line(a) == 'writer-done'
        a.stdin.close()
        a.wait(timeout=5)
        assert sql('select catalog_internal.history_cache_is_usable()').stdout.strip() == 'f'
        parity()
        refresh()
        checks.append({'name': 'Out of order writer commit invalidates full RPC snapshot', 'verdict': 'PASS'})
        with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
            calls = [pool.submit(parity, page) for page in [1, 2, 3, 100, 101, 1324, 1730, 1911]]
            pool.submit(sql, 'select public.refresh_catalog_release_history_cache()').result(timeout=20)
            for call in calls:
                call.result(timeout=20)
        checks.append({'name': 'Eight concurrent RPC sessions plus refresh retain exact parity', 'verdict': 'PASS'})
        sql("begin;insert into version_history(winget_id,version,created_at)values('Fixture.1','new','2027-01-01');")
        a = session()
        send(a, "begin;insert into version_history(winget_id,version,created_at)values('Fixture.1','new','2027-01-01');select catalog_internal.history_cache_is_usable();")
        assert line(a) == 'f'
        parity(101, a)
        close(a)
        assert sql('select catalog_internal.history_cache_is_usable()').stdout.strip() == 't'
        checks.append({'name': 'Own write invalidation and rollback with full RPC parity', 'verdict': 'PASS'})
        a = session()
        send(a, "begin;savepoint cache_probe;truncate version_history;select 'truncated';")
        assert line(a) == 'truncated'
        parity(101, a)
        send(a, 'rollback to savepoint cache_probe;commit;select catalog_internal.history_cache_is_usable();')
        assert line(a) == 't'
        a.stdin.close()
        a.wait(timeout=5)
        checks.append({'name': 'TRUNCATE savepoint rollback restores exact warm cache', 'verdict': 'PASS'})
        for table in ['version_history', 'curated_apps']:
            restore()
            a = session()
            send(a, 'select public.get_catalog_release_history_global_rows(101) is not null;')
            assert line(a) == 't'
            send(a, "begin isolation level repeatable read;select 'snapshot';")
            assert line(a) == 'snapshot'
            sql('truncate public.' + table)
            parity(101, a)
            close(a)
            checks.append({'name': 'Warm session older snapshot TRUNCATE ' + table, 'verdict': 'PASS'})
        restore()
        sql('vacuum full public.version_history')
        assert sql('select catalog_internal.history_cache_is_usable()').stdout.strip() == 'f'
        parity()
        refresh()
        checks.append({'name': 'Triggerless heap rewrite self-heals on refresh', 'verdict': 'PASS'})
        for level in ['repeatable read', 'serializable']:
            denied = sql('begin isolation level ' + level + ';select public.refresh_catalog_release_history_cache();', 'fixture_owner', fail=True)
            assert denied.returncode and 'requires read committed isolation' in denied.stderr
        checks.append({'name': 'Refresh rejects stale isolation levels', 'verdict': 'PASS'})
        restore()
        sql('reindex table version_history;reindex table curated_apps;')
        assert sql('select catalog_internal.history_cache_is_usable()').stdout.strip() == 't'
        parity()
        checks.append({'name': 'Index rewrite retains exact cache', 'verdict': 'PASS'})
        sql('grant usage on schema public to anon,authenticated;grant select on version_history,curated_apps,curated_sync_status to anon,authenticated;')
        assert value("select json_build_array(has_function_privilege('anon','public.refresh_catalog_release_history_cache()','execute'),has_function_privilege('anon','public.get_catalog_release_history_global_rows(integer)','execute'),has_table_privilege('anon','catalog_internal.catalog_release_history_meta','insert'))") == [False, False, False]
        a = session()
        send(a, 'select public.get_catalog_release_history_global_rows(101) is not null;')
        assert line(a) == 't'
        send(a, "begin isolation level repeatable read;select 'snapshot';")
        assert line(a) == 'snapshot'
        sql("alter table curated_apps enable row level security;alter table curated_apps force row level security;create policy fixture_visibility on curated_apps for select using(winget_id='Fixture.1');")
        send(a, 'select count(*) from catalog_internal.catalog_release_history_meta;')
        assert line(a) == '0'
        parity(1, a)
        parity(101, a)
        close(a)
        assert value('select count(*) from catalog_internal.catalog_release_history_meta') == 0
        denied = sql('select public.refresh_catalog_release_history_cache();', fail=True)
        assert denied.returncode and 'unrestricted source visibility' in denied.stderr
        checks.append({'name': 'Concurrent FORCE RLS fail-closed metadata and full RPC parity', 'verdict': 'PASS'})
        restricted = sql("begin;insert into version_history(winget_id,version,created_at)values('Fixture.1','restricted-writer','2027-01-01');insert into version_history(winget_id,version,created_at)values('Fixture.1','restricted-writer-again','2027-01-02');select json_build_array((select count(*) from catalog_internal.catalog_release_history_meta),(select count(*) from catalog_internal.catalog_release_history_page_bounds),(select count(*) from catalog_internal.catalog_release_history_invalidation),(select bool_and(xid=pg_current_xact_id()) from catalog_internal.catalog_release_history_invalidation));rollback;")
        assert json.loads(restricted.stdout.strip()) == [0, 0, 1, True], restricted.stdout
        checks.append({'name': 'Restricted writer still invalidates without cache access', 'verdict': 'PASS'})
        for role in ['anon', 'authenticated']:
            assert value('select count(*) from catalog_internal.catalog_release_history_meta', role) == 0
            assert value('select public.get_catalog_release_history_v2(page_number=>101)=public.oracle_v2(page_number=>101)', role) is True
        checks.append({'name': 'Anonymous/authenticated RLS fallback and denied writes', 'verdict': 'PASS'})
        sql('drop policy fixture_visibility on curated_apps;create policy public_read on curated_apps for select using(true);')
        assert value('select catalog_internal.history_cache_is_usable()', 'anon') is False
        assert value('select public.get_catalog_release_history_v2(page_number=>101)=public.oracle_v2(page_number=>101)', 'anon') is True
        sql(definition + ';\n' + rows_definition + ';')
        sql('drop trigger history_cache_insert on version_history;drop trigger history_cache_structure on version_history;drop trigger history_cache_identity on version_history;drop trigger history_cache_insert on curated_apps;drop trigger history_cache_structure on curated_apps;drop trigger history_cache_identity on curated_apps;drop function public.refresh_catalog_release_history_cache();drop function catalog_internal.history_cache_is_usable();drop function catalog_internal.mark_history_cache_dirty();drop table catalog_internal.catalog_release_history_meta,catalog_internal.catalog_release_history_page_bounds,catalog_internal.catalog_release_history_invalidation;drop function catalog_internal.invoker_has_unrestricted_history_visibility();drop schema catalog_internal;')
        assert value(security_query) == security
        parity()
        checks.append({'name': 'Clean source rollback preserves original RPC security and parity', 'verdict': 'PASS'})
        print('PASS metadata cache bounds, parity, RLS, physical rewrite and transaction contracts', flush=True)
        return checks
    finally:
        for s in sessions:
            if s.poll() is None:
                s.kill()
                s.wait(timeout=5)
        sql('drop database if exists ' + db + ' with(force)', None, 'postgres')
