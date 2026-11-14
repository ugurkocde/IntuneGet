"""Catalog history contracts on the existing disposable PostgreSQL 17 service.

Eight real sessions share a bounded pool. No production data or endpoint is used.
The unchanged old function must fail the same latency contract the candidate passes.
"""
import concurrent.futures
import json
from pathlib import Path
import runpy
import statistics
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]


def contracts(sql):
    database = 'history_contract_' + uuid.uuid4().hex
    migration = (ROOT / 'supabase/migrations/20261114142200_catalog_history_precomputed_rows.sql').read_text()
    restored = (ROOT / 'supabase/migrations/20261114125000_restore_history_after_scope_timeout.sql').read_text()

    def run(text, check=True, role='service_role'):
        return sql(text, role=role, database=database, check=check)

    def value(query, role='service_role'):
        return json.loads(run('select to_json(v) from (' + query + ') v', role=role).stdout.strip())

    # Each shape corresponds to a different product cache key.
    args = ["'','','all',1,'',null,null,''",
            "'','','updated',1,'','2026-01-01',null,''",
            "'Fixture','','all',1,'',null,null,''",
            "'','2026-01','all',1,'',null,null,''",
            "'','','all',1,'',null,null,'x64'",
            "'','','first',1,'',null,null,''",
            "'','','all',5,'',null,null,''",
            "'','','all',1,'Mozilla.Firefox.ESR.fur',null,null,''"]

    def burst(function, mode, with_refresh=False):
        barrier = threading.Barrier(8)

        def request(index):
            barrier.wait(timeout=15)
            started = time.monotonic()
            result = run("set statement_timeout='8s';set plan_cache_mode=" + mode +
                         ';select pg_backend_pid();select public.' + function + '(' + args[index] + ');', False)
            elapsed = (time.monotonic() - started) * 1000
            pid = int(result.stdout.splitlines()[0]) if result.returncode == 0 else None
            return {'shape': index, 'ms': round(elapsed, 2), 'ok': result.returncode == 0, 'pid': pid}

        all_rows, unrelated = [], []
        for wave in range(3):
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                futures = [pool.submit(request, index) for index in range(8)]
                # Include time waiting for a free connection, not just SQL execution.
                started = time.monotonic()

                def point_lookup():
                    result = run("select name from public.curated_apps where winget_id='Fixture.App100'")
                    assert result.returncode == 0
                    return (time.monotonic() - started) * 1000

                point = pool.submit(point_lookup)
                if with_refresh:
                    # The refresh is a separate cron connection sharing CPU and I/O.
                    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as cron:
                        refresh = cron.submit(run, 'select public.refresh_catalog_release_history_rows()')
                        rows = [f.result() for f in futures]
                        assert refresh.result().returncode == 0
                else:
                    rows = [f.result() for f in futures]
                unrelated.append(point.result())
                assert len({r['pid'] for r in rows if r['ok']}) == sum(r['ok'] for r in rows)
                all_rows.extend([{**r, 'wave': wave} for r in rows])
        p95 = sorted(r['ms'] for r in all_rows)[int(len(all_rows) * .95)]
        result = {'function': function, 'mode': mode, 'refresh': with_refresh,
                  'p95_ms': round(p95, 2), 'unrelated_max_ms': round(max(unrelated), 2),
                  'calls': all_rows}
        print(json.dumps(result), flush=True)
        return result

    sql('create database ' + database + ' owner fixture_owner', role=None, database='postgres')
    try:
        version = value("select current_setting('server_version_num')::int n")['n']
        assert 170000 <= version < 180000
        run("create table public.curated_apps(winget_id text primary key,name text,publisher text,is_locale_variant boolean);"
            "create table public.version_history(id integer primary key,winget_id text not null,version text not null,"
            "release_date timestamptz,created_at timestamptz,installers jsonb,unique(winget_id,version)) with (fillfactor=50,autovacuum_enabled=false);"
            "create index idx_version_history_winget_id on public.version_history(winget_id);"
            "create index idx_version_history_observed on public.version_history(winget_id,created_at,id);"
            "create table public.curated_sync_status(id text primary key,last_run_status text,"
            "last_run_completed_at timestamptz,last_successful_sync_at timestamptz);"
            "grant usage on schema public to anon,authenticated,service_role;"
            "grant select on all tables in schema public to anon,authenticated;"
            "grant all on all tables in schema public to service_role;", role='fixture_owner')
        run("set work_mem='3500kB';", role='fixture_owner')
        sql("alter database " + database + " set work_mem='3500kB';alter database " + database +
            " set jit=off;alter database " + database + " set max_parallel_workers_per_gather=1;",
            role=None, database='postgres')
        run("insert into public.curated_apps select case when n=79 then 'Mozilla.Firefox.ESR.fur' else 'Fixture.App'||n end,"
            "case when n=80 then null else 'Fixture '||n end,'Publisher',n<=78 from generate_series(1,16493)n;")
        for start in range(1, 74844, 5000):
            stop = min(start + 4999, 74843)
            run("insert into public.version_history select n,case when (n-1)%16450+1=79 then 'Mozilla.Firefox.ESR.fur' "
                "else 'Fixture.App'||((n-1)%16450+1) end,n::text,null,"
                "'2025-04-01'::timestamptz+(n%330)*interval '1 day',"
                "jsonb_build_array(jsonb_build_object('Architecture','x64','Payload',"
                "(select string_agg(md5((n::bigint*100+k)::text),'') from generate_series(1,44)k))) "
                "from generate_series(" + str(start) + ',' + str(stop) + ')n;')
        run('vacuum analyze public.version_history;', role='fixture_owner')
        run("update public.version_history set release_date=created_at where id<=33679;")
        run('analyze public.version_history;', role='fixture_owner')
        print(json.dumps(value("select count(*) rows,avg(pg_column_size(installers)) installer_bytes from public.version_history")))
        physical = value("select relpages,relallvisible,reltuples from pg_class where oid='public.version_history'::regclass")
        print(json.dumps(physical))
        assert .50 <= physical['relallvisible'] / physical['relpages'] <= .60, physical
        print(json.dumps(value("select version(),current_setting('work_mem') work_mem,current_setting('jit') jit,current_setting('max_parallel_workers_per_gather') parallel")))
        run(restored, role='fixture_owner')
        run(restored.replace('public.get_catalog_release_history_v2(', 'public.legacy_history_oracle('), role='fixture_owner')
        acl_before = value("select proacl::text acl,proconfig,prosecdef from pg_proc where oid="
                           "'public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure")
        baseline = []
        for _ in range(5):
            started = time.monotonic()
            run('select 1')
            baseline.append((time.monotonic() - started) * 1000)
        unrelated_limit = max(500, 2 * statistics.median(baseline))
        red = [burst('get_catalog_release_history_v2', mode) for mode in ['force_generic_plan', 'force_custom_plan']]
        assert any(any(not r['ok'] for r in b['calls']) or b['p95_ms'] >= 2000 or
                   b['unrelated_max_ms'] > unrelated_limit for b in red), 'NO_GO: old body did not reproduce the capacity failure'
        started = time.monotonic()
        run('begin;' + migration + 'commit;', role='fixture_owner')
        print(json.dumps({'initial_fill_ms': round((time.monotonic()-started)*1000, 2)}), flush=True)
        assert value("select proacl::text acl,proconfig,prosecdef from pg_proc where oid="
                     "'public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure") == acl_before
        for mode in ['force_generic_plan', 'force_custom_plan']:
            green = burst('get_catalog_release_history_v2', mode, with_refresh=True)
            assert all(r['ok'] for r in green['calls']) and green['p95_ms'] < 2000
            assert green['unrelated_max_ms'] <= unrelated_limit
        cases = args + ["'','','all',0,'',null,null,''", "'','','all',10001,'',null,null,''",
                        "'','','all',1,'fixture.app1',null,null,''", "'','','all',1,'unknown',null,null,''",
                        "'','2026-01','all',1,'','2026-01-01','2026-01-31','x86'",
                        "null,null,null,null,null,null,null,null"]
        def equivalent():
            for arguments in cases:
                assert value('select public.get_catalog_release_history_v2(' + arguments +
                             ')=public.legacy_history_oracle(' + arguments + ') same')['same']
        equivalent()
        run('delete from public.version_history where id=79;select public.refresh_catalog_release_history_rows();')
        equivalent()
        run("insert into public.version_history values(74844,'Mozilla.Firefox.ESR.fur','new',null,now(),'[]');")
        assert value("select not exists(select 1 from public.catalog_release_history_rows where id=74844) stale")['stale']
        run('select public.refresh_catalog_release_history_rows()')
        equivalent()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as holder:
            lock = holder.submit(run, "begin;select pg_advisory_xact_lock(hashtextextended('catalog_release_history_rows',0));select pg_sleep(2);commit;")
            deadline = time.monotonic() + 2
            while not value("select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.datname=current_database() and l.locktype='advisory' and l.granted) held")['held']:
                assert time.monotonic() < deadline, 'Refresh lock fixture not acquired'
            assert run('select public.refresh_catalog_release_history_rows()').stdout.strip() == '-1'
            assert lock.result().returncode == 0
        for query in ["insert into public.catalog_release_history_rows(id) values(999999)",
                      'select public.refresh_catalog_release_history_rows()']:
            for role in ['anon', 'authenticated']:
                assert run(query, check=False, role=role).returncode != 0
        assert run('select count(*) from public.catalog_release_history_rows', role='anon').returncode == 0
        print('PASS real PG17 eight session capacity RED/GREEN, refresh load, JSON equivalence and ACL')
    finally:
        sql('drop database ' + database + ' with (force)', role=None, database='postgres')


if __name__ == '__main__':
    # Reuse the existing qualified service-container transport without running its main.
    contracts(runpy.run_path(str(ROOT / 'scripts/qa-automation/vt-ledger-postgres.test.py'))['sql'])
