import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

const indexSql = readFileSync(new URL('../../supabase/migrations/20261010194921_qa_resume_due_index.sql', import.meta.url), 'utf8');
const columnSql = readFileSync(new URL('../../supabase/migrations/20261010190933_qa_resume_due_schedule.sql', import.meta.url), 'utf8');
const indexDefinition = `create index idx_packaging_jobs_qa_resume_due
  on public.packaging_jobs (qa_resume_due_at, id) where status = 'awaiting_qa'`;

it('backfills waiting chronology, preserves customer state and defaults new jobs into fair due ordering', async () => {
  const db = new PGlite();
  try {
    await db.exec(`set timezone='UTC'; create table public.packaging_jobs (id text primary key, status text,
      created_at timestamptz not null, error_category text, completed_at timestamptz);
      insert into public.packaging_jobs values
      ('old','awaiting_qa','2026-01-01',null,null),
      ('new','awaiting_qa','2026-02-01',null,null),
      ('done','completed','2026-01-01',null,'2026-01-02');`);
    await db.exec(columnSql);
    await db.exec(`begin; ${indexSql} commit;`);
    const rows = await db.query<{ id: string; qa_resume_due_at: Date }>(`select id, qa_resume_due_at
      from public.packaging_jobs where status='awaiting_qa' order by qa_resume_due_at,id`);
    expect(rows.rows.map(r => r.id)).toEqual(['old', 'new']);
    expect(new Date(rows.rows[0].qa_resume_due_at).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    await db.exec(`update public.packaging_jobs set qa_resume_due_at=now()+interval '10 minutes' where id='old';
      insert into public.packaging_jobs (id,status,created_at) values ('fresh','awaiting_qa',now());`);
    const due = await db.query<{ id: string }>(`select id from public.packaging_jobs
      where status='awaiting_qa' and qa_resume_due_at<=now() order by qa_resume_due_at,id`);
    expect(due.rows.map(r => r.id)).toEqual(['new', 'fresh']);
    expect((await db.query(`select id from public.packaging_jobs where id='done' and status='completed'
      and completed_at='2026-01-02'`)).rows).toHaveLength(1);
    expect((await db.query(`select c.relname from pg_index i join pg_class c on c.oid=i.indexrelid
      where c.relname='idx_packaging_jobs_qa_resume_due' and i.indisvalid`)).rows)
      .toHaveLength(1);
  } finally { await db.close(); }
});

it('accepts a valid prebuilt index in a transaction without creating a duplicate', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table public.packaging_jobs (id text primary key, status text, created_at timestamptz not null);');
    await db.exec(columnSql);
    await db.exec(indexDefinition);
    await db.exec(`begin; ${indexSql} commit;`);
    expect((await db.query(`select indisvalid from pg_index
      where indexrelid = to_regclass('public.idx_packaging_jobs_qa_resume_due')`)).rows).toEqual([{ indisvalid: true }]);
    expect((await db.query('show lock_timeout')).rows).toEqual([{ lock_timeout: '0' }]);
    expect((await db.query('show statement_timeout')).rows).toEqual([{ statement_timeout: '0' }]);
  } finally { await db.close(); }
});

it('rejects an invalid index left by a failed manual concurrent build', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table public.packaging_jobs (id text primary key, status text, created_at timestamptz not null);');
    await db.exec(columnSql);
    await db.exec(indexDefinition);
    await db.exec(`update pg_index set indisvalid=false
      where indexrelid = to_regclass('public.idx_packaging_jobs_qa_resume_due')`);
    await expect(db.exec(`begin; ${indexSql} commit;`)).rejects.toThrow('idx_packaging_jobs_qa_resume_due is invalid');
    await db.exec('rollback;');
    expect((await db.query(`select indisvalid from pg_index
      where indexrelid = to_regclass('public.idx_packaging_jobs_qa_resume_due')`)).rows).toEqual([{ indisvalid: false }]);
  } finally { await db.close(); }
});

it('keeps automatic index creation transactional with bounded lock and statement timeouts', () => {
  expect(indexSql.replace(/^--.*$/gm, '')).not.toMatch(/create\s+index\s+concurrently/i);
  expect(indexSql).toContain("set lock_timeout = '2s'");
  expect(indexSql).toContain("set statement_timeout = '15s'");
  expect(indexSql).toContain('reset statement_timeout;');
  expect(indexSql).toContain('reset lock_timeout;');
});
