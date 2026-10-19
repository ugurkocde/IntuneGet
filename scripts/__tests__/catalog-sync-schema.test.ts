import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const directory = resolve(import.meta.dirname, '../../supabase/migrations');
const files = readdirSync(directory).filter((name) => name.endsWith('_restore_curated_upstream_miss_count.sql'));
if (files.length !== 1) throw new Error('Expected one catalog counter restoration migration');
const migration = readFileSync(resolve(directory, files[0]), 'utf8');
const apply = (db: PGlite) => db.transaction((tx) => tx.exec(migration));

describe('hourly catalog sync counter migration', () => {
  it('restores selection and counter updates while preserving rows and RLS', async () => {
    const db = new PGlite();
    try {
      await db.exec("create table curated_apps(id integer primary key, version text not null);"
        + "insert into curated_apps values(1,'1');alter table curated_apps enable row level security;");
      await expect(db.query('select upstream_miss_count from curated_apps')).rejects.toMatchObject({ code: '42703' });
      await apply(db);
      expect((await db.query('select * from curated_apps')).rows).toEqual([{ id: 1, version: '1', upstream_miss_count: 0 }]);
      await db.exec("insert into curated_apps(id,version) values(2,'2');"
        + 'update curated_apps set upstream_miss_count=upstream_miss_count+1 where id=1;');
      await apply(db);
      expect((await db.query('select upstream_miss_count from curated_apps order by id')).rows)
        .toEqual([{ upstream_miss_count: 1 }, { upstream_miss_count: 0 }]);
      expect((await db.query("select relrowsecurity from pg_class where oid='curated_apps'::regclass")).rows)
        .toEqual([{ relrowsecurity: true }]);
      expect((await db.query("select count(*)::int n from pg_constraint where conrelid='curated_apps'::regclass and contype='c'")).rows)
        .toEqual([{ n: 1 }]);
      await expect(db.exec('update curated_apps set upstream_miss_count=-1')).rejects.toMatchObject({ code: '23514' });
      await expect(db.exec('update curated_apps set upstream_miss_count=null')).rejects.toMatchObject({ code: '23502' });
      await db.exec('update curated_apps set upstream_miss_count=0');
      expect((await db.query('select sum(upstream_miss_count)::int n from curated_apps')).rows).toEqual([{ n: 0 }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it.each([
    'bigint not null default 0 check(upstream_miss_count>=0)',
    'integer default 0 check(upstream_miss_count>=0)',
    'integer not null default 1 check(upstream_miss_count>=0)',
    'integer not null default 0',
  ])('rejects incompatible existing definition: %s', async (definition) => {
    const db = new PGlite();
    try {
      await db.exec(`create table curated_apps(id integer primary key,upstream_miss_count ${definition})`);
      await expect(apply(db)).rejects.toThrow('Incompatible curated_apps');
      expect((await db.query("select col_description('curated_apps'::regclass,2) comment")).rows)
        .toEqual([{ comment: null }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('rejects an unvalidated check', async () => {
    const db = new PGlite();
    try {
      await db.exec('create table curated_apps(upstream_miss_count integer not null default 0);'
        + 'alter table curated_apps add check(upstream_miss_count>=0) not valid;');
      await expect(apply(db)).rejects.toThrow('Incompatible curated_apps');
    } finally {
      await db.close();
    }
  }, 30_000);
});
