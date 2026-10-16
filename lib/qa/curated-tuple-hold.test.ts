import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let db: PGlite;
const pin = 'a'.repeat(40), profile = 'b'.repeat(64), candidate = 'c'.repeat(24);
const key = `release:${candidate}`;
const hold = { schemaVersion: 1, runId: '42', attempt: 1, profileSha256: profile, packagerCommit: pin,
  definitionSha256: 'd'.repeat(64), diagnosticsSha256: 'e'.repeat(64),
  reviewRef: 'node:delegated-task:exact-no-go', reason: 'Reviewed previousInstall timeout; unchanged diagnostics.' };
const enqueue = async (k = key, inputs: object = { candidate: JSON.stringify({ id: candidate, appId: 'firefox', version: '158.0' }) }) =>
  (await db.query<{ result: unknown }>('select enqueue_curated_verification($1,$2,$3,$4,$5) as result', [k, 'firefox', '158.0', 'release', inputs])).rows[0].result;
const row = async () => (await db.query<{ id: string; status: string; hold: unknown; updated_at: string }>('select * from curated_verification_queue where verification_key=$1', [key])).rows[0];
const applyHold = async (data = hold, k = key) => {
  const r = await row();
  return db.query('select hold_curated_verification($1,$2,$3)', [k, r?.updated_at || new Date().toISOString(), data]);
};
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table qa_pipeline_control(id text primary key,paused boolean,required_packager_commit text,scheduler_packager_commit text,scheduler_seen_at timestamptz);
    create table qa_candidates(id uuid primary key,status text,priority int,enqueued_at timestamptz,next_retry_at timestamptz,test_level text,demand_source text,
      attempts int default 0,dispatched_at timestamptz,phase text,phase_started_at timestamptz,phase_updated_at timestamptz,failure_summary text,updated_at timestamptz);
    create table curated_qa_runs(github_run_id text,github_run_attempt int,kind text,config_verification_id uuid,app_id text,tested_version text,candidate_id text,outcome text,package_profile_sha256 text,packager_commit text);
    grant all on qa_pipeline_control,qa_candidates,curated_qa_runs to service_role;`);
  for (const file of ['20261005193149_curated_priority_queue.sql', '20261016010507_curated_reviewed_tuple_hold.sql'])
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
}, 30000);
beforeEach(async () => {
  await db.exec('truncate curated_verification_queue,qa_pipeline_control,qa_candidates,curated_qa_runs');
  await db.query("insert into qa_pipeline_control values ('global',false,$1,$1,now())", [pin]);
  await db.query("insert into curated_qa_runs values ('42',1,'release',null,'firefox','158.0',$1,'Failed',$2,$3)", [candidate,profile,pin]);
  await enqueue();
});
afterAll(async () => db?.close());

describe('reviewed curated tuple hold', () => {
  it('removes a queued duplicate and cannot be reset by cooldown, history loss or new inputs', async () => {
    await applyHold();
    const before = await row();
    await db.exec('delete from curated_qa_runs');
    expect(await enqueue(key, { changedProfile: 'unverified', changedPin: 'unverified' })).toMatchObject({ held: true });
    expect(await row()).toEqual(before);
    expect(before.status).toBe('held');
    expect(before.hold).toEqual(hold);
  });
  it('preserves a completed failed run and its original queue timestamp when held', async () => {
    await db.exec("update curated_verification_queue set status='completed',github_run_id='42',enqueued_at='2020-01-01Z'");
    await applyHold();
    expect((await db.query('select github_run_id,enqueued_at from curated_verification_queue')).rows[0]).toMatchObject({ github_run_id: '42' });
    expect(await enqueue()).toMatchObject({ held: true });
    expect(new Date(String((await db.query('select enqueued_at from curated_verification_queue')).rows[0].enqueued_at)).toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });
  it('cannot claim held work or recycle retained hold metadata after recovery', async () => {
    await applyHold();
    const r = await row();
    const claim = await db.query<{ result: { reason: string } }>("select claim_qa_work('curated',$1,$2) as result", [r.id,pin]);
    expect(claim.rows[0].result.reason).toBe('queue_empty');
    await db.exec("update curated_verification_queue set status='completed'");
    expect(await enqueue()).toMatchObject({ held: true });
    expect((await row()).status).toBe('held');
  });
  it('permits the existing service role to activate only a failed lifecycle hold', async () => {
    await db.exec('set role service_role');
    try { await applyHold(); } finally { await db.exec('reset role'); }
    expect((await row()).status).toBe('held');
  });
  it('allows a new release key and ordinary customer work while the old tuple stays held', async () => {
    await applyHold();
    await enqueue(`release:${'f'.repeat(24)}`);
    await db.exec("insert into qa_candidates(id,status,priority,enqueued_at,next_retry_at,test_level) values ('10000000-0000-4000-8000-000000000001','queued',2100,now(),now(),'psadt-package')");
    const claim = await db.query<{ result: { row: { id: string } } }>("select claim_qa_work('ordinary','10000000-0000-4000-8000-000000000001',$1) as result", [pin]);
    expect(claim.rows[0].result.row.id).toBe('10000000-0000-4000-8000-000000000001');
    expect((await row()).status).toBe('held');
  });
  it('never changes a dispatched row, including the claim-before-hold race order', async () => {
    const r = await row();
    await db.query("select claim_qa_work('curated',$1,$2)", [r.id,pin]);
    await expect(applyHold()).rejects.toThrow(/dispatched|available/i);
    expect((await row()).status).toBe('dispatched');
  });
  it('rejects stale, missing, mismatched or malformed hold evidence', async () => {
    await expect(db.query('select hold_curated_verification($1,$2,$3)',[key,'2000-01-01Z',hold])).rejects.toThrow(/changed/i);
    await expect(applyHold({ ...hold, profileSha256: 'f'.repeat(64) })).rejects.toThrow(/evidence/i);
    await expect(applyHold({ ...hold, reviewRef: '' })).rejects.toThrow(/metadata/i);
    await expect(applyHold(hold,'release:missing')).rejects.toThrow(/missing/i);
    expect((await row()).status).toBe('queued');
  });
  it('does not overwrite an existing hold with another review and exposes no release operation', async () => {
    await applyHold();
    const before = await row();
    await applyHold();
    expect(await row()).toEqual(before);
    await expect(applyHold({ ...hold, reviewRef: 'node:delegated-task:other' })).rejects.toThrow(/existing hold/i);
    expect(await row()).toEqual(before);
  });
  it('rejects a failed custom configuration as release evidence', async () => {
    await db.exec("update curated_qa_runs set kind='config',config_verification_id='10000000-0000-4000-8000-000000000001'");
    await expect(applyHold()).rejects.toThrow(/evidence/i);
    expect((await row()).status).toBe('queued');
  });
  it('rejects a missing or wrong attempt and a failed attempt superseded by a passing rerun', async () => {
    await expect(applyHold({ ...hold, attempt: 2 })).rejects.toThrow(/evidence/i);
    await db.exec("insert into curated_qa_runs select github_run_id,2,kind,config_verification_id,app_id,tested_version,candidate_id,'Passed',package_profile_sha256,packager_commit from curated_qa_runs");
    await expect(applyHold()).rejects.toThrow(/evidence/i);
    expect((await row()).status).toBe('queued');
  });
  it('requires a positive integer attempt in metadata', async () => {
    const absent = { ...hold } as Partial<typeof hold>;
    delete absent.attempt;
    for (const data of [absent, { ...hold, attempt: 0 }, { ...hold, attempt: '1' }, { ...hold, attempt: 1.5 }])
      await expect(db.query('select hold_curated_verification($1,$2,$3)',[key,(await row()).updated_at,data])).rejects.toThrow(/metadata/i);
  });
  it('denies hold activation to browser roles', async () => {
    await db.exec('set role authenticated');
    try { await expect(db.query('select hold_curated_verification($1,$2,$3)',[key,new Date().toISOString(),hold])).rejects.toThrow(/permission denied/i); }
    finally { await db.exec('reset role'); }
  });
});
