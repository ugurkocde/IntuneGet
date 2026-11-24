"""Selection-history rotation on disposable PG17; no production starvation claim."""
import concurrent.futures
import json
from pathlib import Path
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261124021000_qa_demand_selection_rotation.sql'
FUNCTIONS = ['qa_missing_demand_backfill_ids', 'qa_cron_demand_backfill_ids']


def rotation_contracts(sql):
    database = 'selector_rotation_' + uuid.uuid4().hex
    def run(text, role='fixture_owner', check=True, application='selector-rotation'):
        return sql(text, database=database, role=role, check=check, application=application)
    def value(text):
        return json.loads(run(text).stdout.splitlines()[-1])
    def rows(fn, limit=5):
        return value("select coalesce(json_agg(winget_id),'[]'::json) from public." + fn + '(' + str(limit) + ')')
    def snapshot(fn):
        return value("select json_build_object('source',pg_get_functiondef(oid),'config',proconfig,'acl',proacl::text,'owner',proowner,'definer',prosecdef,'volatile',provolatile,'language',prolang) from pg_proc where oid='public." + fn + "(integer)'::regprocedure")
    def select_and_record(fn):
        selected = rows(fn)
        names = ','.join("'" + name.replace("'", "''") + "'" for name in selected)
        run("insert into qa_demand_backfill_selections select x,now() from unnest(array[" + names + "]::text[]) x on conflict(winget_id) do update set last_selected_at=excluded.last_selected_at")
        return selected
    sql('create database ' + database + ' owner fixture_owner', database='postgres', role=None)
    try:
        import runpy
        fixture = runpy.run_path(str(ROOT/'scripts/ci/qa-demand-index-postgres.py'))['FIXTURE']
        run(fixture.split('insert into curated_apps', 1)[0])
        run("create table qa_demand_backfill_selections(winget_id text primary key,last_selected_at timestamptz not null);")
        run("insert into curated_apps select 'Fixture.App'||g,'2',true,true,'win32',false from generate_series(1,18)g;"
            "insert into upload_history select 'Fixture.App'||g,case when g=4 then '2026-01-02'::timestamptz else '2026-01-01'::timestamptz end from generate_series(1,17)g;"
            "insert into app_update_policies values('Fixture.App3','auto_update',true);"
            "insert into qa_candidates values('Fixture.App1','2','2','psadt-package','failed','{\"profileKind\":\"custom\"}','2026-02-02'),('Fixture.App2','2','2','psadt-package','error','{\"profileKind\":\"custom\"}','2026-02-01');"
            "update curated_apps set is_verified=false where winget_id='Fixture.App8';"
            "insert into package_eligibility_blocks values('Fixture.App9');insert into qa_package_blocks values('Fixture.App10','2');"
            "insert into qa_winget_poll_state values('microsoft/winget-pkgs','fixture-head');insert into qa_catalog_reconciliations values('Fixture.App11','2','fixture-head');"
            "insert into qa_candidates values('Fixture.App12','2','1','psadt-package','running','{\"profileKind\":\"catalog-default\"}',null),('Fixture.App13','1','2','psadt-package','error','{\"profileKind\":\"catalog-default\"}',now());"
            "update curated_apps set is_winget_verified=false where winget_id='Fixture.App14';update curated_apps set app_source='store' where winget_id='Fixture.App15';update curated_apps set is_locale_variant=true where winget_id='Fixture.App16';update curated_apps set latest_version=' ' where winget_id='Fixture.App17';"
            "insert into qa_demand_backfill_selections select 'Fixture.App'||g,'2000-01-01' from generate_series(8,18)g;"
            "grant select on all tables in schema public to service_role;")
        for name in ['20260823195500_recognize_live_qa_version_coverage.sql', '20261115144200_qa_demand_failure_key_scope.sql', '20261123143806_qa_demand_timeout_overlap.sql', '20261123204151_qa_demand_eligible_priority_scope.sql', '20261123233922_qa_cron_demand_budget.sql']:
            run('begin;' + (ROOT/'supabase/migrations'/name).read_text() + 'commit;')
        original = {fn: snapshot(fn) for fn in FUNCTIONS}
        expected = ['Fixture.App'+str(i) for i in range(1,8)]
        for fn in FUNCTIONS:
            run("delete from qa_demand_backfill_selections where winget_id in (select 'Fixture.App'||g from generate_series(1,7)g)")
            first = select_and_record(fn)
            second = rows(fn)
            assert first == expected[:5] and second == first
            try:
                assert len(set(first+second)) == 7
            except AssertionError:
                print('RED ' + fn + ': repeats5/7 despite recorded selection history', flush=True)
            else:
                raise AssertionError('Old selector unexpectedly rotated')
        run('begin;' + MIGRATION.read_text() + 'commit;')
        for fn in FUNCTIONS:
            updated = snapshot(fn)
            assert {k:v for k,v in updated.items() if k!='source'} == {k:v for k,v in original[fn].items() if k!='source'}
            # Only the two intended source insertions may differ.
            restored = updated['source'].replace('  left join public.qa_demand_backfill_selections as selection\n    on selection.winget_id = app.winget_id\n','').replace('    selection.last_selected_at asc nulls first,\n','')
            assert restored == original[fn]['source']
            run("delete from qa_demand_backfill_selections where winget_id in (select 'Fixture.App'||g from generate_series(1,7)g)")
            assert rows(fn,100) == expected  # Exclusions and original unseen priority/ties.
            first = select_and_record(fn)
            second = rows(fn)
            assert first == expected[:5] and second == expected[5:]+expected[:3]
            assert len(set(first+second)) == 7
            assert rows(fn,0) == second[:1] and rows(fn,1) == second[:1]
            assert rows(fn,'NULL') == second[:3] and rows(fn,1000) == expected[5:]+expected[:5]
            # A later-selected key cannot precede an older-selected key.
            run("update qa_demand_backfill_selections set last_selected_at='2001-01-01' where winget_id='Fixture.App5'")
            assert rows(fn,100).index('Fixture.App5') < rows(fn,100).index('Fixture.App1')
            for role in ['anon','authenticated']:
                denied = run('select * from public.' + fn + '(5)', role, False)
                assert denied.returncode and 'permission denied' in denied.stderr
            # The shared advisory lock skips, rather than waits for, another caller.
            tag = 'rotation-holder-' + uuid.uuid4().hex[:8]
            run('create table if not exists fixture_rotation_release(done boolean);truncate fixture_rotation_release')
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                holder = pool.submit(run,"begin;select pg_advisory_xact_lock(1849,1);set local statement_timeout='15s';do $$ begin while not exists(select 1 from fixture_rotation_release) loop perform pg_sleep(0.05);end loop;end $$;rollback;", 'fixture_owner', True, tag)
                try:
                    until = time.monotonic()+3
                    while time.monotonic()<until:
                        if value("select to_json(exists(select 1 from pg_stat_activity where datname=current_database() and application_name='"+tag+"' and wait_event='PgSleep'))"):
                            break
                    else:
                        raise AssertionError('Holder was not observed')
                    started=time.monotonic()
                    assert rows(fn)==[] and time.monotonic()-started<1
                finally:
                    run('insert into fixture_rotation_release values(true)')
                    holder.result(timeout=20)
            print('GREEN '+fn+':7/7 rotation,eligible-only,unseen priority/ties,limits,lock skip,config/owner/ACL/source parity',flush=True)
        # The guarded migration is intentionally not reapplied over changed source.
        refused=run('begin;'+MIGRATION.read_text()+'commit;',check=False)
        assert refused.returncode and 'Unexpected demand selector source' in refused.stderr
        for fn in FUNCTIONS:
            run(original[fn]['source'])
            assert snapshot(fn)==original[fn]
        print('PASS selector rollback/source guard; caller and selection-record transaction gap unchanged; production starvation/effect unproven',flush=True)
    finally:
        sql('drop database '+database+' with(force)',database='postgres',role=None)
