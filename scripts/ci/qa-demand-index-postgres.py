"""Demand lookup plan, ordered parity and isolation on disposable PG17 only."""
import concurrent.futures
import json
from pathlib import Path
import runpy
import time
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
 ('Fixture.12','2','2','psadt-package','passed','{"profileKind":"custom"}',now());
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


if __name__ == '__main__':
    t = runpy.run_path(str(ROOT/'scripts/qa-automation/vt-ledger-postgres.test.py'))
    if not t['re'].fullmatch(r'[a-f0-9]{12,64}', t['CONTAINER']):
        raise ValueError('Only the Actions PG17 service container is accepted')
    ports = t['subprocess'].run(['docker','inspect','--format','{{json .HostConfig.PortBindings}}',t['CONTAINER']], capture_output=True,text=True,check=True,env=t['ENV'],timeout=10)
    assert json.loads(ports.stdout) in (None, {})
    contracts(t['sql'])
