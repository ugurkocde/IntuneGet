import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('backfills waiting chronology, preserves customer state and defaults new jobs into fair due ordering', async () => {
  const db = new PGlite();
  try {
    await db.exec(`set timezone='UTC'; create table public.packaging_jobs (id text primary key, status text,
      created_at timestamptz not null, error_category text, completed_at timestamptz);
      insert into public.packaging_jobs values
      ('old','awaiting_qa','2026-01-01',null,null),
      ('new','awaiting_qa','2026-02-01',null,null),
      ('done','completed','2026-01-01',null,'2026-01-02');`);
    await db.exec(readFileSync(new URL('../../supabase/migrations/20261010190933_qa_resume_due_schedule.sql', import.meta.url), 'utf8'));
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
    expect((await db.query(`select indexname from pg_indexes where indexname='idx_packaging_jobs_qa_resume_due'`)).rows)
      .toHaveLength(1);
  } finally { await db.close(); }
});
