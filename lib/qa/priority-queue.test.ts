import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const pin = 'a'.repeat(40);
const ordinaryId = '10000000-0000-4000-8000-000000000001';
let db: PGlite;
const queue = async (key: string, app = 'firefox', supersede: string[] = []) => {
  await db.query('select public.enqueue_curated_verification($1,$2,$3,$4,$5,$6)', [key, app, '2.0', 'release', {}, supersede]);
  return (await db.query<{ id: string }>('select id from curated_verification_queue where verification_key=$1', [key])).rows[0].id;
};
const claim = async (kind: string, id: string) => (await db.query<{ result: { row?: { id: string }; reason?: string } }>(
  'select public.claim_qa_work($1,$2,$3) as result', [kind, id, pin])).rows[0].result;
const ordinary = async (priority = 2000, age = 0) => db.query(
  "insert into qa_candidates(id,status,priority,enqueued_at,next_retry_at,test_level,demand_source) values ($1,'queued',$2,now()-($3 * interval '1 minute'),now(),'psadt-package','customer')",
  [ordinaryId, priority, age]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table qa_pipeline_control(id text primary key, paused boolean, required_packager_commit text, scheduler_packager_commit text, scheduler_seen_at timestamptz);
    create table qa_candidates(id uuid primary key, status text, priority integer, enqueued_at timestamptz,
      next_retry_at timestamptz, test_level text, demand_source text, attempts integer default 0, dispatched_at timestamptz,
      phase text, phase_started_at timestamptz, phase_updated_at timestamptz, failure_summary text, updated_at timestamptz);
    grant all on qa_candidates, qa_pipeline_control to service_role;
    insert into qa_candidates(id,status,priority,demand_source) values
      ('${ordinaryId}','queued',1500,'auto_update');`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261005193149_curated_priority_queue.sql', import.meta.url), 'utf8'));
  expect((await db.query<{ priority: number }>('select priority from qa_candidates')).rows[0].priority).toBe(2000);
}, 30000);
beforeEach(async () => {
  await db.exec('truncate curated_verification_queue, qa_candidates, qa_pipeline_control');
  await db.query("insert into qa_pipeline_control values ('global',false,$1,$1,now())", [pin]);
});
afterAll(async () => db?.close());

describe('shared PostgreSQL QA priority queue', () => {
  it('runs a curated update before background QA and preserves that background row', async () => {
    await ordinary(1, 10);
    const id = await queue('release:new');
    expect(await claim('ordinary', ordinaryId)).toMatchObject({ reason: 'higher_priority_work' });
    expect(await claim('curated', id)).toMatchObject({ row: { id } });
    expect((await db.query<{ status: string }>('select status from qa_candidates')).rows[0].status).toBe('queued');
    expect(await claim('ordinary', ordinaryId)).toMatchObject({ reason: 'qa_active' });
  });
  it('shares urgent priority with customer requests and serves the oldest request first', async () => {
    await ordinary(2000, 1);
    const id = await queue('release:new');
    expect(await claim('curated', id)).toMatchObject({ reason: 'higher_priority_work' });
    expect(await claim('ordinary', ordinaryId)).toMatchObject({ row: { id: ordinaryId } });
    expect(await claim('curated', id)).toMatchObject({ reason: 'qa_active' });
  });
  it('does not let later uploads repeatedly jump ahead of an older curated update', async () => {
    const id = await queue('release:new');
    await ordinary();
    expect(await claim('ordinary', ordinaryId)).toMatchObject({ reason: 'higher_priority_work' });
    expect(await claim('curated', id)).toMatchObject({ row: { id } });
  });
  it('supersedes only queued releases of the same app and never running or unrelated tests', async () => {
    const old = await queue('release:old');
    const other = await queue('release:other', 'vscode');
    const running = await queue('release:running');
    await db.query("update curated_verification_queue set status='dispatched' where id=$1", [running]);
    await queue('release:new', 'firefox', [old, other, running]);
    const rows = (await db.query<{ id: string; status: string }>('select id,status from curated_verification_queue')).rows;
    expect(rows.find(row => row.id === old)?.status).toBe('superseded');
    expect(rows.find(row => row.id === other)?.status).toBe('queued');
    expect(rows.find(row => row.id === running)?.status).toBe('dispatched');
  });
  it('deduplicates repeated polls without resetting FIFO age or an active claim', async () => {
    const id = await queue('release:new');
    await db.query("update curated_verification_queue set enqueued_at=now()-interval '1 hour' where id=$1", [id]);
    const before = (await db.query<{ enqueued_at: Date }>('select enqueued_at from curated_verification_queue')).rows[0].enqueued_at;
    expect(await queue('release:new')).toBe(id);
    expect((await db.query<{ enqueued_at: Date }>('select enqueued_at from curated_verification_queue')).rows[0].enqueued_at).toEqual(before);
    await claim('curated', id);
    await queue('release:new');
    expect((await db.query<{ status: string }>('select status from curated_verification_queue')).rows[0].status).toBe('dispatched');
  });
  it('respects maintenance and current packager readiness', async () => {
    const id = await queue('release:new');
    await db.exec('update qa_pipeline_control set paused=true');
    expect(await claim('curated', id)).toMatchObject({ reason: 'maintenance_paused' });
    await db.exec("update qa_pipeline_control set paused=false,scheduler_seen_at=now()-interval '16 minutes'");
    expect(await claim('curated', id)).toMatchObject({ reason: 'packager_release_pending' });
  });
  it('denies public table access and public queue claims', async () => {
    const privileges = await db.query<{ table_access: boolean; claim_access: boolean }>(
      "select has_table_privilege('anon','curated_verification_queue','select') as table_access, has_function_privilege('authenticated','claim_qa_work(text,uuid,text)','execute') as claim_access");
    expect(privileges.rows[0]).toEqual({ table_access: false, claim_access: false });
  });
});
