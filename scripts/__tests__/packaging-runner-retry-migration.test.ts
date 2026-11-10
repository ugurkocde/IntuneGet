import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('defaults existing jobs to no retry and enforces the persisted retry bound', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('create table public.packaging_jobs (id integer primary key); insert into public.packaging_jobs values (1)');
    await pg.exec(readFileSync(resolve(import.meta.dirname, '../../supabase/migrations/20261110114742_packaging_runner_loss_retry.sql'), 'utf8'));
    expect((await pg.query('select infrastructure_retry_count,infrastructure_retry_run_id from public.packaging_jobs')).rows)
      .toEqual([{ infrastructure_retry_count: 0, infrastructure_retry_run_id: null }]);
    await pg.exec("update public.packaging_jobs set infrastructure_retry_count=1,infrastructure_retry_run_id='42' where id=1");
    expect((await pg.query('select infrastructure_retry_count,infrastructure_retry_run_id from public.packaging_jobs')).rows)
      .toEqual([{ infrastructure_retry_count: 1, infrastructure_retry_run_id: '42' }]);
    for (const value of [-1, 2]) {
      await expect(pg.exec(`update public.packaging_jobs set infrastructure_retry_count=${value} where id=1`)).rejects.toThrow();
    }
    await expect(pg.exec('update public.packaging_jobs set infrastructure_retry_count=null where id=1')).rejects.toThrow();
    await pg.exec('insert into public.packaging_jobs (id) values (2)');
    expect((await pg.query('select infrastructure_retry_count from public.packaging_jobs where id=2')).rows)
      .toEqual([{ infrastructure_retry_count: 0 }]);
  } finally {
    await pg.close();
  }
}, 30000);
