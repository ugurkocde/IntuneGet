"""Real PG17 recent-count regression; no production load or incident reproduction.

Production RED is recorded separately from the informational OLD8 CI baseline.
Never escalate load or relabel a passing baseline. All timing is client wall time.
"""
import concurrent.futures
import json
from pathlib import Path
import runpy
import threading
import time
import uuid
ROOT = Path(__file__).resolve().parents[2]
OLD = ROOT/'supabase/migrations/20261114230100_bound_catalog_history_app_plan.sql'
NEW = ROOT/'supabase/migrations/20261115050439_catalog_recent_update_count.sql'

def contracts(sql, transport):
    database = 'recent_count_' + uuid.uuid4().hex
    def run(text, role='fixture_owner', check=True):
        return sql(text, database=database, role=role, check=check)
    def value(text, role='fixture_owner'):
        return json.loads(run(text, role).stdout)
    old_call = "select (public.get_catalog_release_history_v2(kind_filter=>'updated',date_from=>'2026-02-16')->>'total')::bigint"
    new_call = "select public.get_catalog_recent_update_count('2026-02-16')"
    def burst(mode):
        barrier = threading.Barrier(8)
        def call(i):
            query = old_call
            barrier.wait(timeout=10)
            started = time.monotonic()
            result = run("set application_name='recent-count-load';set statement_timeout='3s';set plan_cache_mode=force_generic_plan;\n\\set VERBOSITY verbose\n" + query + ';', role='service_role', check=False)
            elapsed = (time.monotonic()-started)*1000
            if result.returncode:
                assert '57014' in result.stderr and 'statement timeout' in result.stderr, 'Infrastructure/query failure is not a RED'
            return elapsed, result.returncode != 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
            calls = [pool.submit(call,i) for i in range(8)]
            deadline = time.monotonic() + 5
            active = 0
            while time.monotonic() < deadline:
                observed = sql("select count(*) from pg_stat_activity where datname=current_database() and application_name='recent-count-load' and state='active' and query like '%public.get_catalog_%'", database=database, role=None)
                active = int(observed.stdout.strip())
                if active == 8 or all(f.done() for f in calls):
                    break
                time.sleep(0.01)
            unrelated = None
            if active == 8:
                started = time.monotonic()
                point = pool.submit(lambda: run("select winget_id from public.curated_apps where winget_id='Fixture.1'",role='service_role'))
                point.result(timeout=20)
                unrelated = (time.monotonic()-started)*1000
            results = [f.result(timeout=20) for f in calls]
        return {'mode':mode,'sessions':8,'max_ms':round(max(t for t,_ in results),2),'timeouts57014':sum(f for _,f in results),'unrelated_ms':round(unrelated,2) if unrelated is not None else None,'active_at_probe':active,'statement_timeout':'3s'}
    def gated_burst(mode):
        # Park clients before timing; only timestamps around real queries prove load.
        holder = transport['subprocess'].Popen(
            transport['command'](database, 'recent-count-gate'),
            stdin=transport['subprocess'].PIPE, stdout=transport['subprocess'].PIPE,
            stderr=transport['subprocess'].PIPE, text=True, env=transport['ENV'])
        def gate_count(granted):
            return int(sql("select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid "
                "where a.datname=current_database() and l.locktype='advisory' and l.objid=19160 "
                "and l.granted=" + ('true' if granted else 'false') + " and a.application_name "
                + ("='recent-count-gate'" if granted else "in ('recent-count-load','recent-count-probe')"),
                database=database, role=None).stdout.strip())
        def wait_for_gate(count, granted):
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if holder.poll() is not None:
                    raise AssertionError('Gate holder exited; infrastructure failure')
                if gate_count(granted) == count:
                    return
            raise AssertionError('Gate precondition not observed; no concurrency claim')
        try:
            holder.stdin.write('select pg_advisory_lock(19160);\n')
            holder.stdin.flush()
            wait_for_gate(1, True)
            released = threading.Event()
            release_time = [None]
            def call(i):
                probe = i == 8
                query = ("select winget_id from public.curated_apps where winget_id='Fixture.1'" if probe
                    else "select public.get_catalog_release_history_v2()" if mode == 'mixed' and i % 2
                    else new_call)
                own_key = '' if probe else 'select pg_advisory_lock(' + str(19170+i) + ');'
                starts_seen = ''.join('select pg_advisory_lock_shared(' + str(19170+k) + ');' for k in range(8)) if probe else ''
                announce_start = '' if probe else 'select pg_advisory_unlock(' + str(19170+i) + ');'
                result = run("set application_name='recent-count-" + ('probe' if probe else 'load')
                    + "';set lock_timeout='15s';set statement_timeout='15s';"
                    + own_key + "select pg_advisory_lock_shared(19160);" + starts_seen + "set statement_timeout='3s';"
                    "set plan_cache_mode=force_generic_plan;\n\\set VERBOSITY verbose\n"
                    "select 't0='||extract(epoch from clock_timestamp());" + announce_start + query + ";"
                    "select 't1='||extract(epoch from clock_timestamp());", role='service_role', check=False)
                finished = time.monotonic()
                if result.returncode:
                    raise AssertionError('Gated query failed; infrastructure/query failure, no GREEN')
                assert released.is_set(), 'Query bypassed gate'
                t0, t1 = query_interval(result.stdout)
                return {'start':t0,'end':t1,'client_ms':(finished-release_time[0])*1000}
            with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
                calls = [pool.submit(call, i) for i in range(9)]
                try:
                    wait_for_gate(9, False)
                    release_time[0] = time.monotonic()
                    released.set()
                    holder.stdin.write('select pg_advisory_unlock(19160);\n\\q\n')
                    holder.stdin.flush()
                finally:
                    # Release even on an observation failure so executor cleanup is bounded.
                    if not released.is_set():
                        holder.stdin.close()
                        holder.stdin = None
                        holder.terminate()
                results = [f.result(timeout=20) for f in calls]
            workers, probe = results[:8], results[8]
            return measure_overlap(workers, probe)
        finally:
            if holder.stdin is not None:
                holder.stdin.close()
                holder.stdin = None
            if holder.poll() is None:
                holder.terminate()
            try:
                holder.communicate(timeout=5)
            except transport['subprocess'].TimeoutExpired:
                holder.kill()
                holder.communicate(timeout=5)
    sql('create database ' + database + ' owner fixture_owner',role=None,database='postgres')
    try:
        run('alter database '+database+" set work_mem='3500kB';alter database "+database+" set max_parallel_workers_per_gather=1;")
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
        run('begin;'+OLD.read_text()+'commit;')
        signature='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'
        run('revoke all on function '+signature+' from public;grant execute on function '+signature+' to anon,authenticated,service_role;')
        pin = value("select json_build_object('body',md5(prosrc),'acl',proacl::text) from pg_proc where oid='"+signature+"'::regprocedure")
        assert pin['body'] == '69204a947d44d31b8a4924c73ff14d4a', pin
        old = burst('old')
        print('OLD real PG17 recent8 '+json.dumps(old),flush=True)
        print('Production RED: 2026-11-15 04:50-07:40 UTC recent path 23 SQLSTATE57014 and one abort; OLD8 CI baseline retained without reproduction claim',flush=True)
        run("insert into public.curated_apps values('Boundary.App','Boundary','Fixture',false);"
            "insert into public.version_history(winget_id,version,created_at,installers) values"
            "('Boundary.App','a','2026-02-15 23:59:59.999+00',null),"
            "('Boundary.App','b','2026-02-16 00:00:00+00','[]'),"
            "('Boundary.App','c','2026-02-16 00:00:00+00','[]'),"
            "('Boundary.App','null',null,null),('Not.Curated','x','2026-02-17',null);")
        run('begin;'+NEW.read_text()+'commit;')
        dates=['1999-12-31','2026-01-01','2026-01-12','2026-02-15','2026-02-16','2026-02-20','2026-02-22','2026-03-01']
        counts=[]
        for role in ['fixture_owner','service_role']:
            for zone in ['UTC','America/Los_Angeles']:
                for day in dates:
                    result=value("set timezone='"+zone+"';select json_build_object('new',public.get_catalog_recent_update_count('"+day+"'),'old',(public.get_catalog_release_history_v2(kind_filter=>'updated',date_from=>'"+day+"')->>'total')::bigint)",role)
                    assert result['new']==result['old'],(role,zone,day,result)
                    counts.append(result['new'])
        assert len(set(counts))>1
        assert value("select coalesce(to_json(public.get_catalog_recent_update_count(null)),'null'::json)") is None
        for role in ['anon','authenticated']:
            denied=run("select public.get_catalog_recent_update_count('2026-02-16')",role,False)
            assert denied.returncode and 'permission denied' in denied.stderr
        attrs=value("select json_build_object('invoker',not prosecdef,'stable',provolatile='s','strict',proisstrict,'config',proconfig,'anon',has_function_privilege('anon',oid,'EXECUTE'),'auth',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE'),'public',exists(select 1 from aclexplode(proacl) where grantee=0)) from pg_proc where oid='public.get_catalog_recent_update_count(date)'::regprocedure")
        assert attrs=={'invoker':True,'stable':True,'strict':True,'config':['search_path=""'],'anon':False,'auth':False,'service':True,'public':False},attrs
        for mode in ['candidate','mixed']:
            timing=gated_burst(mode)
            print('GREEN real PG17 '+json.dumps(timing),flush=True)
            assert timing['max_server_ms']<2000 and timing['max_client_ms']<2000,timing
            assert timing['unrelated_server_ms']<1000 and timing['unrelated_client_ms']<1000,timing
        run('drop function public.get_catalog_recent_update_count(date)')
        after=value("select json_build_object('body',md5(prosrc),'acl',proacl::text) from pg_proc where oid='"+signature+"'::regprocedure")
        assert after==pin
        print('PASS PG17 recent candidate+mixed8 GREEN/parity/role ACL/unchanged69204a94/rollback; informational OLD8 retained; production effect unverified',flush=True)
    finally:
        sql('drop database '+database+' with(force)',database='postgres',role=None)

def query_interval(stdout):
    starts = [float(line[3:]) for line in stdout.splitlines() if line.startswith('t0=')]
    ends = [float(line[3:]) for line in stdout.splitlines() if line.startswith('t1=')]
    assert len(starts) == len(ends) == 1 and ends[0] >= starts[0], 'Missing query interval'
    return starts[0], ends[0]


def measure_overlap(workers, probe):
    assert len(workers) == 8, 'Eight workers required'
    latest_start = max(w['start'] for w in workers)
    earliest_end = min(w['end'] for w in workers)
    assert latest_start < earliest_end, '8-way overlap not achieved; no concurrency claim'
    assert probe['start'] >= latest_start, 'Probe started before all workers'
    assert probe['start'] < earliest_end and probe['end'] > latest_start, 'Probe did not overlap all eight queries'
    return {'sessions':8,'parked_at_gate':9,'overlap8':True,'timeouts57014':0,
        'max_server_ms':round(max(w['end']-w['start'] for w in workers)*1000,2),
        'max_client_ms':round(max(w['client_ms'] for w in workers),2),
        'unrelated_server_ms':round((probe['end']-probe['start'])*1000,2),
        'unrelated_client_ms':round(probe['client_ms'],2),
        'timing':'server query intervals and client completion since gate release; not comparable to informational OLD process wall time'}


if __name__=='__main__':
    t=runpy.run_path(str(ROOT/'scripts/qa-automation/vt-ledger-postgres.test.py'))
    if not t['re'].fullmatch(r'[a-f0-9]{12,64}',t['CONTAINER']):
        raise ValueError('Only existing pinned Actions PG17 service accepted')
    ports=t['subprocess'].run(['docker','inspect','--format','{{json .HostConfig.PortBindings}}',t['CONTAINER']],capture_output=True,text=True,check=True,env=t['ENV'],timeout=10)
    assert json.loads(ports.stdout) in (None,{})
    contracts(t['sql'], t)
