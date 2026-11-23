"""Demand lookup plan, ordered parity and isolation on disposable PG17 only."""
import concurrent.futures
import json
from pathlib import Path
import runpy
import time
import threading
import uuid

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = '20261115102714_qa_demand_failure_lookup_index.sql'
INDEX = 'qa_candidates_psadt_failure_idx'
FIXTURE = """
create table upload_history(winget_id text,deployed_at timestamptz);
create table app_update_policies(winget_id text,policy_type text,is_enabled boolean);
create table qa_candidates(winget_id text,version text,catalog_version_at_enqueue text,test_level text,status text,test_config jsonb,finished_at timestamptz);
create table curated_apps(winget_id text primary key,latest_version text,is_verified boolean,is_winget_verified boolean,app_source text,is_locale_variant boolean);
create table package_eligibility_blocks(winget_id text primary key);
create table qa_package_blocks(winget_id text,version text);
create table qa_catalog_reconciliations(winget_id text,catalog_version text,observed_head_sha text);
create table qa_winget_poll_state(id text,head_sha text);
insert into curated_apps select 'Fixture.'||g,'2',true,true,'win32',false from generate_series(1,1000)g;
insert into upload_history select 'Fixture.'||(g%1000+1),'2026-01-01'::timestamptz+g*interval '1 second' from generate_series(1,100000)g;
insert into app_update_policies select 'Fixture.'||g,'auto_update',g%2=0 from generate_series(1,1000)g;
insert into qa_candidates select 'Fixture.'||(g%1000+1),'1','1','psadt-package',case when g%11=0 then 'failed' else 'passed' end,'{"profileKind":"catalog-default"}','2026-01-01'::timestamptz from generate_series(1,50000)g;
-- Negative eligibility fixtures and both current-version coverage alternatives.
update curated_apps set is_verified=false where winget_id='Fixture.1';
update curated_apps set is_winget_verified=false where winget_id='Fixture.2';
update curated_apps set app_source='store' where winget_id='Fixture.3';
update curated_apps set is_locale_variant=true where winget_id='Fixture.4';
update curated_apps set latest_version=' ' where winget_id='Fixture.5';
insert into package_eligibility_blocks values('Fixture.6');
insert into qa_package_blocks values('Fixture.7','2');
insert into qa_winget_poll_state values('microsoft/winget-pkgs','fixture-head');
insert into qa_catalog_reconciliations values('Fixture.8','2','fixture-head');
insert into qa_candidates values
 ('Fixture.9','2','1','psadt-package','passed','{"profileKind":"catalog-default"}',now()),
 ('Fixture.10','1','2','psadt-package','error','{"profileKind":"catalog-default"}',now()),
 ('Fixture.11','2','2','psadt-package','superseded','{"profileKind":"catalog-default"}',now()),
 ('Fixture.12','2','2','psadt-package','passed','{"profileKind":"custom"}',now()),
 -- Eligible custom profiles must retain current-version failure priority.
 ('Fixture.11','2','1','psadt-package','failed','{"profileKind":"custom"}','2026-02-01T00:00:00Z'),
 ('Fixture.12','1','2','psadt-package','error','{"profileKind":"custom"}','2026-02-02T00:00:00Z');
analyze;
"""


def executed_nodes(item):
    if isinstance(item, list):
        return [node for child in item for node in executed_nodes(child)]
    if isinstance(item, dict):
        own = [item] if item.get('Actual Loops', 0) > 0 else []
        return own + [node for child in item.values() for node in executed_nodes(child)]
    return []


def contracts(sql):
    database = 'demand_index_' + uuid.uuid4().hex
    def run(text, role='fixture_owner', check=True):
        return sql(text, database=database, role=role, check=check)
    def value(text):
        return json.loads(run(text).stdout)
    def snapshot():
        return value("select row_to_json(p) from (select md5(prosrc) body,proacl::text,proconfig,prosecdef from pg_proc where oid='public.qa_missing_demand_backfill_ids(integer)'::regprocedure)p")
    def results(limit):
        return value('select coalesce(json_agg(winget_id),\'[]\'::json) from public.qa_missing_demand_backfill_ids(' + limit + ')')
    def plan():
        return value('explain(analyze,buffers,format json) ' + query)
    sql('create database ' + database + ' owner fixture_owner', role=None, database='postgres')
    try:
        run(FIXTURE)
        old = (ROOT/'supabase/migrations/20260823195500_recognize_live_qa_version_coverage.sql').read_text()
        run(old)
        run('grant select on all tables in schema public to service_role')
        query = old.split('as $$')[1].split('$$;')[0].replace('p_limit', '3')
        before = snapshot()
        limits = ['NULL', '0', '1', '3', '100', '101']
        expected = [results(limit) for limit in limits]
        assert expected[0][:2] == ['Fixture.12', 'Fixture.11'], expected[0]
        assert expected[1] == ['Fixture.12'] and expected[2] == ['Fixture.12']
        assert not set(expected[-1]).intersection('Fixture.' + str(n) for n in range(1, 11))
        old_plan = plan()
        assert not any(n.get('Index Name') == INDEX for n in executed_nodes(old_plan))
        print('RED demand failure lookup has no bounded partial index', flush=True)
        run('begin;' + (ROOT/'supabase/migrations'/MIGRATION).read_text() + 'commit;')
        assert snapshot() == before
        assert [results(limit) for limit in limits] == expected
        new_plan = plan()
        assert any(n.get('Index Name') == INDEX for n in executed_nodes(new_plan)), new_plan
        for role in ['anon', 'authenticated']:
            denied = run('select * from public.qa_missing_demand_backfill_ids(3)', role, False)
            assert denied.returncode and 'permission denied' in denied.stderr
        def read(i):
            started = time.monotonic()
            run("set statement_timeout='2s';select * from public.qa_missing_demand_backfill_ids(3)", 'service_role')
            return (time.monotonic()-started)*1000
        with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
            futures = [pool.submit(read, i) for i in range(8)]
            started = time.monotonic()
            run("select * from public.curated_apps where winget_id='Fixture.11';insert into public.qa_candidates values('Fixture.New','1','1','psadt-package','failed','{}',now());")
            point_ms = (time.monotonic()-started)*1000
            times = [f.result(timeout=20) for f in futures]
        assert max(times) < 2000 and point_ms < 1000, (times, point_ms)
        run('drop index public.' + INDEX)
        assert snapshot() == before and [results(limit) for limit in limits] == expected
        print('PASS PG17 demand index used; ordered/filter parity, body/config/ACL, denied roles, rollback, eight-client max_ms=' + str(round(max(times), 2)) + ' point_insert_ms=' + str(round(point_ms, 2)) + '; no server-overlap or production recovery claim', flush=True)
    finally:
        sql('drop database ' + database + ' with (force)', database='postgres', role=None)


def early_demand_contracts(sql, with_timeout=False):
    import uuid
    name = 'demand_keys_' + uuid.uuid4().hex
    def run(text, role='fixture_owner', check=True):
        return sql(text, database=name, role=role, check=check)
    def value(text):
        return json.loads(run(text).stdout)
    def snap():
        return value("select json_build_object('acl',proacl::text,'config',proconfig,'definer',prosecdef,'stable',provolatile) from pg_proc where oid='public.qa_missing_demand_backfill_ids(integer)'::regprocedure")
    def counts(body):
        prefix = body.split('as $$',1)[1].split('\n  select app.winget_id',1)[0]
        return value(prefix + ' select to_json(count(*)) from current_version_failures')
    def results():
        return [value('select coalesce(json_agg(winget_id),\'[]\'::json) from public.qa_missing_demand_backfill_ids('+limit+')') for limit in ['NULL','0','1','3','5','100','1000']]
    sql('create database '+name+' owner fixture_owner',database='postgres',role=None)
    try:
        fixture = runpy.run_path(str(ROOT/'scripts/ci/qa-demand-index-postgres.py'))['FIXTURE']
        run(fixture)
        run('grant select on all tables in schema public to service_role')
        # Fixed demanded set; unrelated current-version failures have no uploads.
        run("insert into curated_apps select 'Unrelated.'||g,'2',true,true,'win32',false from generate_series(1,5000)g;insert into qa_candidates select 'Unrelated.'||g,'2','2','psadt-package','failed','{}','2026-01-01' from generate_series(1,5000)g;analyze;")
        old = (ROOT/'supabase/migrations/20260823195500_recognize_live_qa_version_coverage.sql').read_text().replace('\r\n','\n')
        run(old)
        if with_timeout:
            run("create function public.qa_idle_catalog_backfill_ids(integer) returns setof text language sql as 'select null::text where false';create function public.qa_toolchain_backfill_page(text,integer,text[]) returns setof text language sql as 'select null::text where false';")
            run((ROOT/'supabase/migrations/20261115020254_qa_optional_backfill_timeout.sql').read_text())
        before = snap()
        expected = results()
        baseline = counts(old)
        assert baseline > 5000, 'Unrelated aggregation RED not reproduced'
        try:
            assert baseline <= 1000, 'Failure groups include unrelated keys'
        except AssertionError:
            print('RED early demand key scope: unrelated aggregate groups='+str(baseline),flush=True)
        else:
            raise AssertionError('Old function unexpectedly passed the bounded-key regression')
        run('begin;'+(ROOT/'supabase/migrations/20261115144200_qa_demand_failure_key_scope.sql').read_text()+'commit;')
        assert snap() == before and results() == expected
        candidate = counts((ROOT/'supabase/migrations/20261115144200_qa_demand_failure_key_scope.sql').read_text())
        assert candidate <= 1000 and candidate < baseline
        for role in ['anon','authenticated']:
            denied=run('select * from public.qa_missing_demand_backfill_ids(5)',role,False)
            assert denied.returncode and 'permission denied' in denied.stderr
        def read(i):
            started = time.monotonic()
            run("set statement_timeout='2s';select * from public.qa_missing_demand_backfill_ids(5)", 'service_role')
            return (time.monotonic()-started)*1000
        with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
            futures = [pool.submit(read, i) for i in range(8)]
            started = time.monotonic()
            run("select * from public.curated_apps where winget_id='Fixture.11';insert into public.qa_candidates values('Fixture.New','1','1','psadt-package','failed','{}',now());")
            point_ms = (time.monotonic()-started)*1000
            times = [f.result(timeout=20) for f in futures]
        assert max(times) < 2000 and point_ms < 1000, (times, point_ms)
        print('GREEN early demand eight-client max_ms=' + str(round(max(times), 2)) + ' point_insert_ms=' + str(round(point_ms, 2)) + '; client wall timing only', flush=True)
        # Restore exact source and the starting configuration in both variants.
        run(old)
        if with_timeout:
            run((ROOT/'supabase/migrations/20261115020254_qa_optional_backfill_timeout.sql').read_text())
        assert snap() == before and results() == expected
        print('GREEN early demand key scope groups='+str(candidate)+' ordered/filter/ACL/config/security parity and rollback; production effect unverified',flush=True)
    finally:
        sql('drop database '+name+' with(force)',database='postgres',role=None)

def bounded_demand_contracts(sql, with_timeout=False):
    """Real sessions: production counts are causal RED, overlap is behavior RED.

    Hoisting models PostgREST's separate pre-request settings statement; merely
    SETting statement_timeout inside a direct function call does not arm it.
    """
    database = 'demand_bound_' + uuid.uuid4().hex
    migration = ROOT/'supabase/migrations/20261123143806_qa_demand_timeout_overlap.sql'
    original = (ROOT/'supabase/migrations/20261115144200_qa_demand_failure_key_scope.sql').read_text().replace('\r\n','\n')
    original_query = original.split('as $$\n',1)[1].split('\n$$;',1)[0]
    wrapped_query = migration.read_text().replace('\r\n','\n').split(' RETURN QUERY\n',1)[1].split('\nEND;',1)[0]
    assert wrapped_query == original_query, 'Eligibility, ordering or query body changed'
    def run(text, role='fixture_owner', check=True, application='demand-bound'):
        return sql(text, database=database, role=role, check=check, application=application)
    def value(text):
        return json.loads(run(text).stdout.splitlines()[-1])
    def snapshot():
        return value("select json_build_object('body',md5(prosrc),'acl',proacl::text,'config',proconfig,'definer',prosecdef,'volatile',provolatile,'owner',proowner) from pg_proc where oid='public.qa_missing_demand_backfill_ids(integer)'::regprocedure")
    def results(limit):
        return value("select coalesce(json_agg(winget_id),'[]'::json) from public.qa_missing_demand_backfill_ids("+limit+")")
    def hold_and_call(pool, kind, candidate):
        statement = ('select pg_advisory_xact_lock(1849,1)' if kind == 'overlap'
                     else 'lock table public.curated_apps in access exclusive mode')
        tag = 'demand-bound-holder-' + kind
        run('create table if not exists fixture_holder_release(done boolean);truncate fixture_holder_release;')
        future = pool.submit(run, "begin;"+statement+";set local statement_timeout='15s';"
                             "do $$ begin while not exists(select 1 from fixture_holder_release) loop "
                             "perform pg_sleep(0.05);end loop;end $$;rollback;",
                             'fixture_owner', True, tag)
        try:
            # Observe lock acquisition, then retain it until the probe finishes.
            seen = False
            until = time.monotonic() + 3
            while time.monotonic() < until:
                seen = json.loads(run("select to_json(count(*)>0) from pg_stat_activity where datname=current_database() and application_name='"+tag+"' and wait_event='PgSleep'", role=None).stdout.splitlines()[-1])
                if seen:
                    break
            assert seen, 'Concurrent holder precondition not observed'
            pre = "\n\\set VERBOSITY verbose\nset lock_timeout=0;\n"
            if kind == 'deadline':
                # Model PostgREST's separate pre-request statement boundary.
                timeout = value("select to_json(coalesce((select split_part(s,'=',2) from pg_proc p cross join lateral unnest(p.proconfig)s where p.oid='public.qa_missing_demand_backfill_ids(integer)'::regprocedure and s like 'statement_timeout=%'),'8s'))")
                pre += "select set_config('statement_timeout','"+timeout+"',false);\n"
            start = time.monotonic()
            response = run(pre+"select coalesce(json_agg(winget_id),'[]'::json) from public.qa_missing_demand_backfill_ids(3)",
                           'service_role', False)
            elapsed = (time.monotonic()-start)*1000
        finally:
            run('insert into fixture_holder_release values(true)')
            future.result(timeout=20)
        if kind == 'overlap':
            rows = json.loads(response.stdout.splitlines()[-1]) if not response.returncode else None
            if candidate:
                assert rows == [] and elapsed < 1000, (response.stderr, rows, elapsed)
            else:
                assert rows, 'OLD overlap RED did not reproduce'
            return elapsed
        if candidate:
            assert response.returncode and '57014' in response.stderr and 'statement timeout' in response.stderr, response.stderr
            assert elapsed < 2500, elapsed
        else:
            assert response.returncode and '57014' in response.stderr and elapsed >= 7500, (response.stderr, elapsed)
        return elapsed
    sql('create database '+database+' owner fixture_owner', database='postgres', role=None)
    try:
        run(FIXTURE)
        run((ROOT/'supabase/migrations/20260823195500_recognize_live_qa_version_coverage.sql').read_text())
        run('begin;'+(ROOT/'supabase/migrations/20261115144200_qa_demand_failure_key_scope.sql').read_text()+'commit;')
        if with_timeout:
            run("alter function public.qa_missing_demand_backfill_ids(integer) set statement_timeout='2s'")
        before = snapshot()
        assert before['body'] == 'e358c88ca1ad6f6fcd0ee5d51b96840b'
        limits = ['NULL','-5','0','1','3','5','100','1000']
        expected = [results(n) for n in limits]
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            hold_and_call(pool, 'overlap', False)
            old_deadline = None if with_timeout else hold_and_call(pool, 'deadline', False)
        print('RED actual OLD overlap returns work; with_timeout='+str(with_timeout)+'; API8s old_ms='+str(old_deadline), flush=True)
        run('begin;'+migration.read_text()+'commit;')
        after = snapshot()
        assert after['acl'] == before['acl'] and after['owner'] == before['owner']
        assert after['definer'] and after['volatile'] == 'v'
        assert after['config'] == ['search_path=""','statement_timeout=2s']
        assert [results(n) for n in limits] == expected
        for role in ['anon','authenticated']:
            denied = run('select * from public.qa_missing_demand_backfill_ids(3)',role,False)
            assert denied.returncode and 'permission denied' in denied.stderr
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            overlap_ms = hold_and_call(pool, 'overlap', True)
            timeout_ms = hold_and_call(pool, 'deadline', True)
        # The failed session has closed; a fresh session can perform later work.
        assert results('3') == expected[4]
        barrier = threading.Barrier(9)
        def parallel_read(_):
            barrier.wait(timeout=10)
            started = time.monotonic()
            response = run("select coalesce(json_agg(winget_id),'[]'::json) from public.qa_missing_demand_backfill_ids(3)",'service_role')
            rows = json.loads(response.stdout.splitlines()[-1])
            assert rows in ([], expected[4])
            return (time.monotonic()-started)*1000
        with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
            futures = [pool.submit(parallel_read,i) for i in range(8)]
            barrier.wait(timeout=10)
            point_started = time.monotonic()
            run("select * from public.curated_apps where winget_id='Fixture.11'")
            point_ms = (time.monotonic()-point_started)*1000
            times = [f.result(timeout=15) for f in futures]
        assert max(times) < 2000 and point_ms < 1000, (times,point_ms)
        run('begin;'+(ROOT/'supabase/migrations/20260823195500_recognize_live_qa_version_coverage.sql').read_text()+'commit;')
        run('begin;'+(ROOT/'supabase/migrations/20261115144200_qa_demand_failure_key_scope.sql').read_text()+'commit;')
        if with_timeout:
            run("alter function public.qa_missing_demand_backfill_ids(integer) set statement_timeout='2s'")
        assert snapshot() == before and [results(n) for n in limits] == expected
        print('GREEN demand overlap_skip_ms='+str(overlap_ms)+' hoisted_timeout57014_ms='+str(timeout_ms)+' eight_session_max_ms='+str(max(times))+' point_ms='+str(point_ms)+' parity/ACL/owner/rollback; production cause/effect and live hoisting unverified',flush=True)
    finally:
        sql('drop database '+database+' with(force)',database='postgres',role=None)


if __name__ == '__main__':
    t = runpy.run_path(str(ROOT/'scripts/qa-automation/vt-ledger-postgres.test.py'))
    if not t['re'].fullmatch(r'[a-f0-9]{12,64}', t['CONTAINER']):
        raise ValueError('Only the Actions PG17 service container is accepted')
    ports = t['subprocess'].run(['docker','inspect','--format','{{json .HostConfig.PortBindings}}',t['CONTAINER']], capture_output=True,text=True,check=True,env=t['ENV'],timeout=10)
    assert json.loads(ports.stdout) in (None, {})
    contracts(t['sql'])
    early_demand_contracts(t['sql'])
    early_demand_contracts(t['sql'], with_timeout=True)
    bounded_demand_contracts(t['sql'])
    bounded_demand_contracts(t['sql'], with_timeout=True)
