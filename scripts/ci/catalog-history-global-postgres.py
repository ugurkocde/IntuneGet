"""Global history plan and mixed eight-client contract on disposable PG17.

This proves the bounded first-row plan and CI latency, not production reproduction or
fleet-wide capacity. The earlier OLD8 PASS and OLD16 RED are retained separately.
"""
import concurrent.futures
import json
from pathlib import Path
import runpy
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
OLD = ROOT / 'supabase/migrations/20261114230100_bound_catalog_history_app_plan.sql'
NEW = ROOT / 'supabase/migrations/20261115083235_catalog_history_global_page_plan.sql'


def contracts(sql):
    database = 'history_capacity_' + uuid.uuid4().hex
    def run(text, role='fixture_owner'):
        return sql(text, database=database, role=role)
    def value(text):
        return json.loads(run(text).stdout)
    def nodes(plan):
        result = []
        def walk(item):
            if isinstance(item, dict):
                if 'Node Type' in item and item.get('Actual Loops', 0) > 0:
                    result.append(item)
                for child in item.values():
                    walk(child)
            elif isinstance(item, list):
                for child in item:
                    walk(child)
        walk(plan)
        return result
    def plans(app):
        text = ("load 'auto_explain';set auto_explain.log_min_duration=0;"
                "set auto_explain.log_nested_statements=on;set auto_explain.log_analyze=on;"
                "set auto_explain.log_timing=off;set auto_explain.log_format='json';"
                "set auto_explain.log_level='notice';set plan_cache_mode=force_generic_plan;"
                "set role fixture_owner;select public.get_catalog_release_history_v2(app_filter=>" + quote(app) + ");")
        result = run(text, role=None)
        decoded = []
        decoder = json.JSONDecoder()
        position = 0
        while True:
            position = result.stderr.find('{', position)
            if position < 0:
                break
            try:
                plan, length = decoder.raw_decode(result.stderr[position:])
                decoded.append(plan)
                position += length
            except ValueError:
                position += 1
        found = nodes(decoded)
        assert found, 'No executed nested function plans captured'
        return found
    def shape(plan):
        return [(n['Node Type'], n.get('Relation Name'), n.get('Index Name')) for n in plan
                if n.get('Relation Name')]
    def indexed(plan):
        return any(n.get('Index Name') == 'idx_curated_apps_history_app_lower' for n in plan)
    def burst(rows_only=False):
        barrier = threading.Barrier(8)
        def call(i):
            barrier.wait(timeout=10)
            started = time.monotonic()
            if rows_only:
                page = [2, 3, 4, 20, 100, 500, 1000, 1813][i]
                run("set statement_timeout='3s';select public.get_catalog_release_history_global_rows(" + str(page) + ")", 'service_role')
            else:
                run("set plan_cache_mode=force_generic_plan;select public.get_catalog_release_history_v2(app_filter=>" + quote('' if i % 2 == 0 else 'Fixture.' + str(i + 1)) + ");")
            return (time.monotonic() - started) * 1000
        with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
            calls = [pool.submit(call, i) for i in range(8)]
            started = time.monotonic()
            point = pool.submit(lambda: run("select winget_id from public.curated_apps where winget_id='Fixture.1'"))
            point.result(timeout=20)
            unrelated = (time.monotonic() - started) * 1000
            times = sorted(f.result(timeout=20) for f in calls)
        # Nearest-rank p95 for eight observations is their maximum.
        return {'sessions': 8, 'p95_ms': round(times[-1], 2), 'unrelated_ms': round(unrelated, 2),
                'timing': 'client process wall time; unrelated includes executor admission wait'}

    sql('create database ' + database + ' owner fixture_owner', role=None, database='postgres')
    try:
        run("create table public.curated_apps(winget_id text primary key,name text,publisher text,is_locale_variant boolean);"
            "create table public.version_history(id serial primary key,winget_id text,version text,release_date text,created_at timestamptz,installers jsonb,unique(winget_id,version));"
            "create index idx_version_history_winget_id on public.version_history(winget_id);"
            "create index idx_version_history_winget_id_created_at_id on public.version_history(winget_id,created_at,id);"
            "create index idx_version_history_observed on public.version_history(created_at desc,id desc);"
            "create table public.curated_sync_status(id text primary key,last_run_status text,last_run_completed_at timestamptz,last_successful_sync_at timestamptz);"
            "insert into public.curated_apps select 'Fixture.'||g,'App '||g,'Publisher',g>9055 from generate_series(1,16492)g;"
            "insert into public.curated_apps values('fixture.1','Case variant','Publisher',false);"
            "insert into public.version_history(winget_id,version,created_at,installers) "
            "select 'Fixture.'||((g-1)%16492+1),(1+(g-1)/16492)::text,'2026-01-01'::timestamptz+g*interval '1 minute',"
            "jsonb_build_array(jsonb_build_object('Architecture','x64','Padding',repeat('p',1000)),jsonb_build_object('Architecture','arm64')) "
            "from generate_series(1,74842)g;"
            "insert into public.version_history(winget_id,version,created_at,installers) values('fixture.1','case-version','2026-01-01','[]');"
            "alter table public.curated_apps enable row level security;"
            "create policy catalog_read on public.curated_apps for select using(true);"
            "alter table public.version_history enable row level security;"
            "create policy history_read on public.version_history for select using(true);"
            "grant select on public.curated_apps,public.version_history,public.curated_sync_status to anon,authenticated,service_role;"
            "analyze public.curated_apps;analyze public.version_history;")
        old = OLD.read_text().replace('\r\n', '\n')
        new = NEW.read_text().replace('\r\n', '\n')
        run(old)
        signature = 'public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'
        before_acl = value("select coalesce(to_json(proacl::text),'null'::json) from pg_proc where oid='"+signature+"'::regprocedure")
        before_md5 = value("select to_json(md5(prosrc)) from pg_proc where oid='"+signature+"'::regprocedure")
        old_app = shape(plans('Fixture.1'))
        old_global = plans('')
        def per_app_loops(plan):
            return max((n['Actual Loops'] for n in plan if n.get('Relation Name')=='version_history' and n['Node Type'] in ('Index Scan','Index Only Scan')), default=0)
        assert per_app_loops(old_global) > 1000, 'Old global first-row probes were not reproduced'
        print('RED old global query probes first rows across the full catalog', flush=True)
        run(old.replace('public.get_catalog_release_history_v2(', 'public.history_parity_oracle(', 1))
        run('begin;' + new + 'commit;')
        candidate = plans('')
        assert per_app_loops(candidate) <= 40, 'Global query still performs catalog wide first-row probes'
        assert shape(plans('Fixture.1')) == old_app, 'Per-app executed plan changed'
        assert value("select coalesce(to_json(proacl::text),'null'::json) from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure") == before_acl
        # A representative matrix covers every filter and empty/miss/locale/case/page shape.
        cases = [(app, month, kind, page, search, architecture, start, end)
                 for app in ('', None, 'fIxTuRe.1', 'Missing.App', 'x'*130, 'Fixture.16000')
                 for month, kind, page, search, architecture, start, end in (
                     ('', 'all', 1, '', '', None, None),
                     ('2026-01', 'first', 10000, '', 'x64', '2026-01-01', '2026-01-31'),
                     ('', 'updated', 1, 'App', 'arm64', None, None),
                     ('2026-02', 'all', 2, 'Publisher', 'x86', '2026-02-01', '2026-02-28'))]
        cases += [('', '', 'all', page, '', '', None, None) for page in (0, 2, 10000)]
        for app, month, kind, page, search, architecture, start, end in cases:
            args = ','.join([quote(search), quote(month), quote(kind), str(page), quote(app), quote(start) + '::date', quote(end) + '::date', quote(architecture)])
            assert value('select to_json(public.get_catalog_release_history_v2(' + args + ') = public.history_parity_oracle(' + args + '))') is True
        timing = burst()
        print('GREEN global candidate force_generic bounded first-row plan; ' + json.dumps(timing), flush=True)
        assert timing['p95_ms'] < 2000, timing
        assert timing['unrelated_ms'] < 1000, timing
        # Exercise the additive rows RPC on the same real PG17 fixture and roles.
        v2_before = value("select json_build_array(md5(prosrc),proacl::text) from pg_proc where oid='"+signature+"'::regprocedure")
        run('begin;' + (ROOT/'supabase/migrations/20261115133712_catalog_history_global_rows.sql').read_text() + 'commit;')
        for page in [0, 1, 2, 500, 1813, 10000]:
            assert value("select to_json(public.get_catalog_release_history_global_rows("+str(page)+") = (public.get_catalog_release_history_v2(page_number=>"+str(page)+")->'rows'))") is True
        assert value("select to_json(not prosecdef and provolatile='s' and proconfig=ARRAY['search_path=\"\"'] and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE') and has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where oid='public.get_catalog_release_history_global_rows(integer)'::regprocedure") is True
        rows_timing = burst(True)
        print('GREEN real PG17 additive rows RPC eight-session ' + json.dumps(rows_timing), flush=True)
        assert rows_timing['p95_ms'] < 2000 and rows_timing['unrelated_ms'] < 1000, rows_timing
        run('drop function public.get_catalog_release_history_global_rows(integer)')
        assert value("select json_build_array(md5(prosrc),proacl::text) from pg_proc where oid='"+signature+"'::regprocedure") == v2_before
        print('PASS real PG17 additive rows parity/service ACL/unchanged v2/drop rollback/eight sessions; client wall timing only, production effect unverified', flush=True)
        run('begin;' + old + 'commit;')
        assert value("select to_json(md5(prosrc)) from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure") == before_md5 == '69204a947d44d31b8a4924c73ff14d4a'
        assert value("select coalesce(to_json(proacl::text),'null'::json) from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure") == before_acl
        print('PASS real PG17 global first-row plan RED/GREEN, unchanged app plan, full JSON parity, ACL, rollback and mixed eight-session timing; production effect unverified', flush=True)
    finally:
        sql('drop database ' + database + ' with (force)', role=None, database='postgres')


def quote(value):
    return 'NULL' if value is None else "'" + value.replace("'", "''") + "'"


if __name__ == '__main__':
    transport = runpy.run_path(str(ROOT / 'scripts/qa-automation/vt-ledger-postgres.test.py'))
    # Same service guard as the existing transport; never host or production PG.
    if not transport['re'].fullmatch(r'[a-f0-9]{12,64}', transport['CONTAINER']):
        raise ValueError('Only the Actions PG17 service container is accepted')
    inspected = transport['subprocess'].run(['docker', 'inspect', '--format', '{{json .HostConfig.PortBindings}}', transport['CONTAINER']], capture_output=True, text=True, check=True, env=transport['ENV'], timeout=10)
    assert json.loads(inspected.stdout) in (None, {})
    contracts(transport['sql'])
