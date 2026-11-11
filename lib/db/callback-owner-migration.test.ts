import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('migrates legacy PostgreSQL rows without claiming them and fences concurrent snapshots', async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE public.packaging_jobs (id text PRIMARY KEY, github_run_id text); INSERT INTO packaging_jobs VALUES ('job','41')");
    await pg.exec(readFileSync(new URL('../../supabase/migrations/20261111100757_callback_run_ownership.sql', import.meta.url), 'utf8'));
    expect((await pg.query('SELECT * FROM packaging_jobs')).rows).toEqual([{ id: 'job', github_run_id: '41', callback_run_id: null }]);
    const claim = 'UPDATE packaging_jobs SET callback_run_id=$1,github_run_id=$1 WHERE id=$2 AND callback_run_id IS NULL RETURNING callback_run_id';
    expect((await pg.query(claim, ['43', 'job'])).rows).toEqual([{ callback_run_id: '43' }]);
    // Both callbacks observed null. The second write must lose even without a timestamp trigger.
    expect((await pg.query(claim, ['44', 'job'])).rows).toEqual([]);
    expect((await pg.query('SELECT github_run_id,callback_run_id FROM packaging_jobs')).rows).toEqual([{ github_run_id: '43', callback_run_id: '43' }]);
  } finally {
    await pg.close();
  }
});
