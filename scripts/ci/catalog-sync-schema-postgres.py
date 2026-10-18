"""Catalog counter contracts in a separate disposable PostgreSQL database.

The caller supplies the existing CI-only service-container SQL transport.
No production endpoint, credentials or QA fixture tables are used.
"""
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[2]


def contracts(sql):
    files = list((ROOT / 'supabase/migrations').glob('*_restore_curated_upstream_miss_count.sql'))
    assert len(files) == 1
    migration = files[0].read_text()
    database = 'catalog_contract_' + uuid.uuid4().hex

    def run(text, check=True):
        return sql(text, database=database, check=check)

    def value(query):
        return json.loads(run('select to_json(v) from (' + query + ') v').stdout)

    def snapshot():
        return value("select c.relrowsecurity,c.relacl::text,"
                     "(select coalesce(json_agg(row_to_json(p)),'[]'::json) from "
                     "(select policyname,permissive,roles,cmd,qual,with_check from pg_policies "
                     "where schemaname='public' and tablename='curated_apps' order by policyname) p) policies "
                     "from pg_class c where c.oid='public.curated_apps'::regclass")

    def apply(check=True):
        # psql's explicit transaction mirrors apply_migration's atomic unit.
        return run('begin;\n' + migration + '\ncommit;', check)

    sql('create database ' + database + ' owner fixture_owner', role=None, database='postgres')
    try:
        run("create table public.curated_apps(id integer primary key,version text not null);"
            "insert into public.curated_apps values(1,'1');"
            "alter table public.curated_apps enable row level security;"
            "create policy catalog_read on public.curated_apps for select to anon using(true);"
            "grant select on public.curated_apps to anon;")
        before = snapshot()
        failed = run('select upstream_miss_count from public.curated_apps', False)
        assert failed.returncode and 'does not exist' in failed.stderr
        outside = run("set lock_timeout='6s';\n" + migration, False)
        assert outside.returncode and 'requires a transaction' in outside.stderr
        assert value("select count(*) n from information_schema.columns where table_schema='public' "
                     "and table_name='curated_apps' and column_name='upstream_miss_count'")['n'] == 0
        apply()
        assert value('select count(*) n,min(upstream_miss_count) minimum,max(upstream_miss_count) maximum '
                     'from public.curated_apps') == {'n': 1, 'minimum': 0, 'maximum': 0}
        assert snapshot() == before
        run("insert into public.curated_apps(id,version) values(2,'2');"
            "update public.curated_apps set upstream_miss_count=upstream_miss_count+1 where id=1;")
        assert value('select upstream_miss_count n from public.curated_apps where id=1')['n'] == 1
        apply()
        assert value('select upstream_miss_count n from public.curated_apps where id=1')['n'] == 1
        assert value("select count(*) n from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid "
                     "and c.conkey=array[a.attnum] where a.attrelid='public.curated_apps'::regclass "
                     "and a.attname='upstream_miss_count' and c.contype='c'")['n'] == 1
        for assignment, message in [('-1', 'check constraint'), ('null', 'not-null constraint')]:
            failed = run('update public.curated_apps set upstream_miss_count=' + assignment, False)
            assert failed.returncode and message in failed.stderr
        run('update public.curated_apps set upstream_miss_count=0')
        assert value('select sum(upstream_miss_count) n from public.curated_apps')['n'] == 0
        # Each incompatible preexisting definition must fail and roll back fully.
        for definition in ['bigint not null default 0 check(upstream_miss_count>=0)',
                           'integer default 0 check(upstream_miss_count>=0)',
                           'integer not null default 1 check(upstream_miss_count>=0)',
                           'integer not null default 0']:
            run('drop table public.curated_apps;create table public.curated_apps(id integer primary key,'
                'upstream_miss_count ' + definition + ');')
            failed = apply(False)
            assert failed.returncode and 'Incompatible curated_apps' in failed.stderr
            assert value("select col_description('public.curated_apps'::regclass,2) comment")['comment'] is None
        run('alter table public.curated_apps add check(upstream_miss_count>=0) not valid;')
        failed = apply(False)
        assert failed.returncode and 'Incompatible curated_apps' in failed.stderr
        print('PASS catalog counter missing-column reproduction, atomic repair, replay, ACL/RLS and drift rejection')
    finally:
        sql('drop database ' + database + ' with (force)', role=None, database='postgres')
