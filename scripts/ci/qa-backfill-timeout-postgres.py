"""Disposable PG17 timeout semantics, with an independent concurrent detail read.

This models PostgREST hoisting; it does not prove the production API configuration,
CPU/pool causality, or a full browser render.
"""
import concurrent.futures
import json
from pathlib import Path
import re
import runpy
import subprocess
import time
import uuid
ROOT = Path(__file__).resolve().parents[2]

def contracts(sql):
    database = 'backfill_budget_' + uuid.uuid4().hex
    def run(query, check=True):
        return sql(query, database=database, check=check)
    def value(query):
        return json.loads(run(query).stdout)
    sql('create database ' + database + ' owner fixture_owner', role=None, database='postgres')
    try:
        for name, args in [('qa_missing_demand_backfill_ids','integer'),('qa_idle_catalog_backfill_ids','integer'),('qa_toolchain_backfill_page','text,integer,text[]')]:
            run('create function public.' + name + '(' + args + ") returns table(winget_id text) language plpgsql stable security definer set search_path='' as $$begin perform pg_sleep(3); return query select 'Fixture.App'::text;end$$;")
        run("create table public.curated_apps(winget_id text primary key,name text);insert into public.curated_apps values('Fixture.App','Fixture');")
        before = value("select json_agg(json_build_object('name',proname,'body',md5(prosrc),'acl',proacl::text,'definer',prosecdef) order by proname) from pg_proc where pronamespace='public'::regnamespace")
        migration = (ROOT/'supabase/migrations/20261115020254_qa_optional_backfill_timeout.sql').read_text()
        run('begin;' + migration + 'commit;')
        after = value("select json_agg(json_build_object('name',proname,'body',md5(prosrc),'acl',proacl::text,'definer',prosecdef) order by proname) from pg_proc where pronamespace='public'::regnamespace")
        assert before == after
        assert value("select to_json(count(*)) from pg_proc where pronamespace='public'::regnamespace and 'statement_timeout=2s'=any(proconfig) and 'search_path=\"\"'=any(proconfig)") == 3
        # Inside-function SET does not arm a new timer for the running statement.
        started = time.monotonic()
        run('select public.qa_missing_demand_backfill_ids(5)')
        assert time.monotonic()-started >= 2.8
        # The preceding set_config is the transaction setting that PostgREST hoists.
        def backfill():
            started = time.monotonic()
            result = run("begin;select set_config('statement_timeout','2s',true);select public.qa_missing_demand_backfill_ids(5);commit;", False)
            return result, time.monotonic()-started
        def detail():
            started = time.monotonic()
            run("select name from public.curated_apps where winget_id='Fixture.App'")
            return time.monotonic()-started
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            slow = pool.submit(backfill)
            app = pool.submit(detail)
            detail_seconds = app.result(timeout=10)
            result, elapsed = slow.result(timeout=10)
        assert result.returncode and 'statement timeout' in result.stderr
        assert 1.8 <= elapsed < 3.0, elapsed
        assert detail_seconds < 1.0, detail_seconds
        print('PASS PG17 hoisted 2s timeout, unchanged bodies/ACL/security/search_path; concurrent detail data read ms=' + str(round(detail_seconds*1000,2)) + '; production hoisting and full render remain unverified', flush=True)
    finally:
        sql('drop database ' + database + ' with (force)', database='postgres', role=None)

if __name__ == '__main__':
    t = runpy.run_path(str(ROOT/'scripts/qa-automation/vt-ledger-postgres.test.py'))
    if not re.fullmatch(r'[a-f0-9]{12,64}',t['CONTAINER']):
        raise ValueError('Only the Actions PG17 service container is accepted')
    ports = subprocess.run(['docker','inspect','--format','{{json .HostConfig.PortBindings}}',t['CONTAINER']],capture_output=True,text=True,check=True,env=t['ENV'],timeout=10)
    assert json.loads(ports.stdout) in (None,{})
    contracts(t['sql'])
