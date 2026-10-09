import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('curated live session migration in PostgreSQL', () => {
  let db: PGlite;
  const queue = '11111111-1111-4111-8111-111111111111';
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table public.curated_verification_queue(id uuid primary key,app_id text,version text,kind text,status text,inputs jsonb,
        dispatched_at timestamptz,github_run_id text);
      create table public.qa_candidates(id uuid primary key,status text);
      insert into curated_verification_queue values('${queue}','chrome','1.0','release','dispatched','{}',now()-interval '1 hour',null);`);
    await db.exec(readFileSync('supabase/migrations/20261008180149_qa_live_curated_sessions.sql', 'utf8'));
  });
  afterAll(async () => { await db?.close(); });
  const begin = async (attempt = 1, custom = false) => (await db.query<{ result: { status: string; sessionId: string; publicFrames: boolean } }>(
    `select public.begin_qa_live_curated_session('chrome','1.0','x64',false,$1,123,$2) result`, [custom, attempt])).rows[0].result;

  it('expires inactive and over-age telemetry without retiring an owner by heartbeat age or changing queues', async () => {
    await db.exec('begin');
    try {
      const s = (await db.query<{ result: { sessionId: string } }>(`select begin_qa_live_curated_session('chrome','1.0','x64',false,false,999,1) result`)).rows[0].result;
      await db.exec(`update qa_live_sessions set heartbeat_at=now()-interval '3 hours' where id='${s.sessionId}'`);
      expect((await db.query('select expire_qa_live_curated_sessions() n')).rows[0]).toEqual({ n: 0 });
      await db.exec(`update qa_live_sessions set started_at=now()-interval '4 hours' where id='${s.sessionId}'`);
      expect((await db.query('select expire_qa_live_curated_sessions() n')).rows[0]).toEqual({ n: 1 });
      expect((await db.query(`select state,end_reason from qa_live_sessions where id='${s.sessionId}'`)).rows[0]).toEqual({ state: 'ended', end_reason: 'expired' });
      expect((await db.query('select status from curated_verification_queue')).rows[0]).toEqual({ status: 'dispatched' });
      const next = (await db.query<{ result: { sessionId: string } }>(`select begin_qa_live_curated_session('chrome','1.0','x64',false,false,1000,1) result`)).rows[0].result;
      await db.exec(`update curated_verification_queue set status='completed'`);
      expect((await db.query('select expire_qa_live_curated_sessions() n')).rows[0]).toEqual({ n: 1 });
      expect((await db.query(`select end_reason from qa_live_sessions where id='${next.sessionId}'`)).rows[0]).toEqual({ end_reason: 'dispatch_inactive' });
    } finally { await db.exec('rollback'); }
  });
  it('creates an inert private bucket and service-only RPCs', async () => {
    const { rows } = await db.query<{ anon: boolean; service: boolean; public: boolean }>(`select
      has_function_privilege('anon','public.begin_qa_live_curated_session(text,text,text,boolean,boolean,bigint,integer)','execute') anon,
      has_function_privilege('service_role','public.begin_qa_live_curated_session(text,text,text,boolean,boolean,bigint,integer)','execute') service,
      public from storage.buckets where id='qa-live-session-frames'`);
    expect(rows[0]).toEqual({ anon: false, service: true, public: false });
  });
  it('refuses a session while ordinary QA owns the VM and leaves both queues unchanged', async () => {
    await db.exec(`insert into qa_candidates values('22222222-2222-4222-8222-222222222222','running')`);
    expect((await begin()).status).toBe('refused');
    expect((await db.query('select count(*)::integer n from qa_live_sessions')).rows[0]).toEqual({ n: 0 });
    await db.exec('delete from qa_candidates');
  });
  it('resumes the same attempt and irreversibly removes publicity when host config is present', async () => {
    const original = await begin();
    expect(original).toMatchObject({ status: 'started', publicFrames: true });
    const privateResult = await begin(1, true);
    expect(privateResult).toMatchObject({ status: 'resumed', sessionId: original.sessionId, publicFrames: false });
    expect((await begin()).publicFrames).toBe(false);
  });
  it('supersedes only a higher attempt, rejects delayed phases and never takes over by heartbeat age', async () => {
    const next = await begin(2);
    expect(next.status).toBe('started');
    expect((await begin(1)).status).toBe('refused');
    await db.exec(`update qa_live_sessions set heartbeat_at=now()-interval '1 hour' where id='${next.sessionId}'`);
    expect((await db.query<{ result: { status: string } }>(`select begin_qa_live_curated_session('chrome','1.0','x64',false,false,456,1) result`)).rows[0].result.status).toBe('refused');
    expect((await db.query(`select publish_qa_live_curated_phase('${next.sessionId}',123,2,'installing',now()) accepted`)).rows[0]).toEqual({ accepted: true });
    expect((await db.query(`select publish_qa_live_curated_phase('${next.sessionId}',123,2,'uninstalling',now()-interval '1 minute') accepted`)).rows[0]).toEqual({ accepted: false });
  });
  it('rejects custom queue frames even when a caller previously began a public session', async () => {
    const s = await begin(2);
    await db.exec(`update curated_verification_queue set inputs='{"psadt_config":{"tenant":"private"}}' where id='${queue}'`);
    expect((await db.query(`select authorize_qa_live_curated_frame('${s.sessionId}',123,2,now()) accepted`)).rows[0]).toEqual({ accepted: false });
    await db.exec(`update curated_verification_queue set inputs='{}' where id='${queue}'`);
  });
  it('publishes increasing immutable frames, rejects old sequences and ends idempotently without changing a verdict', async () => {
    const s = await begin(2);
    const frame = (n: number) => db.query(`select publish_qa_live_curated_frame_metadata('${s.sessionId}',123,2,'sessions/${s.sessionId}/frame-${n}.jpg',${n},now(),640,480,100) accepted`);
    expect((await frame(2)).rows[0]).toEqual({ accepted: true });
    expect((await frame(1)).rows[0]).toEqual({ accepted: false });
    expect((await db.query('select sequence::integer from qa_live_session_frames')).rows[0]).toEqual({ sequence: 2 });
    const end = () => db.query<{ result: { status: string } }>(`select end_qa_live_curated_session('${s.sessionId}',123,2) result`);
    expect((await end()).rows[0].result.status).toBe('ended');
    expect((await end()).rows[0].result.status).toBe('ended');
    expect((await begin(2)).status).toBe('refused');
    expect((await db.query('select count(*)::integer n from qa_live_session_frames')).rows[0]).toEqual({ n: 0 });
    expect((await db.query('select status from curated_verification_queue')).rows[0]).toEqual({ status: 'dispatched' });
  });
  const beginRun = async (run: number, attempt = 1) => (await db.query<{ result: { status: string; sessionId: string; endedSessionIds: string[] } }>(
    `select public.begin_qa_live_curated_session('chrome','1.0','x64',false,false,$1,$2) result`, [run, attempt])).rows[0].result;
  const phase = async (id: string, run: number) => (await db.query<{ accepted: boolean }>(
    `select publish_qa_live_curated_phase('${id}',${run},1,'installing',now()) accepted`)).rows[0].accepted;
  const frameAllowed = async (id: string, run: number) => (await db.query<{ accepted: boolean }>(
    `select authorize_qa_live_curated_frame('${id}',${run},1,now()) accepted`)).rows[0].accepted;
  const session = async (id: string) => (await db.query<{ state: string; end_reason: string | null }>(
    `select state,end_reason from qa_live_sessions where id='${id}'`)).rows[0];
  it('retires a crashed session when the same queue row is dispatched again', async () => {
    const crashed = await beginRun(100);
    expect(crashed.status).toBe('started');
    expect(await phase(crashed.sessionId, 100)).toBe(true);
    // Run 100 dies without end. The same verification key is dispatched again later.
    await db.exec(`update qa_live_sessions set started_at=started_at-interval '1 minute' where id='${crashed.sessionId}';
      update curated_verification_queue set dispatched_at=now() where id='${queue}'`);
    expect(await phase(crashed.sessionId, 100)).toBe(false);
    expect(await frameAllowed(crashed.sessionId, 100)).toBe(false);
    expect((await beginRun(100)).status).toBe('refused');
    expect(await session(crashed.sessionId)).toEqual({ state: 'active', end_reason: null });
    const next = await beginRun(200);
    expect(next).toMatchObject({ status: 'started', endedSessionIds: [crashed.sessionId] });
    expect(await session(crashed.sessionId)).toEqual({ state: 'ended', end_reason: 'dispatch_inactive' });
    expect(await phase(next.sessionId, 200)).toBe(true);
    expect(await frameAllowed(next.sessionId, 200)).toBe(true);
    // An ended attempt never becomes active again, even after its row is retired.
    expect((await beginRun(100)).status).toBe('refused');
    expect((await beginRun(200)).status).toBe('resumed');
  });
  it('retires an old session when the queue records a different run, never by heartbeat age alone', async () => {
    const current = (await db.query<{ id: string }>(`select id from qa_live_sessions where state='active'`)).rows[0].id;
    await db.exec(`update qa_live_sessions set heartbeat_at=now()-interval '3 hours' where id='${current}'`);
    expect((await beginRun(300)).status).toBe('refused');
    expect(await session(current)).toEqual({ state: 'active', end_reason: null });
    await db.exec(`update curated_verification_queue set github_run_id='300' where id='${queue}'`);
    expect(await phase(current, 200)).toBe(false);
    expect(await frameAllowed(current, 200)).toBe(false);
    expect((await beginRun(200, 2)).status).toBe('refused');
    const next = await beginRun(300);
    expect(next).toMatchObject({ status: 'started', endedSessionIds: [current] });
    expect(await session(current)).toEqual({ state: 'ended', end_reason: 'dispatch_inactive' });
    expect(await phase(next.sessionId, 300)).toBe(true);
    expect((await db.query('select status,github_run_id from curated_verification_queue')).rows[0]).toEqual({ status: 'dispatched', github_run_id: '300' });
  });
  it('refuses a higher attempt of an old run after redispatch before the genuine run begins', async () => {
    await db.exec(`update qa_live_sessions set state='ended',ended_at=now(),end_reason='dispatch_inactive',started_at=started_at-interval '1 minute' where github_run_id=300;
      update curated_verification_queue set dispatched_at=now(),github_run_id=null where id='${queue}'`);
    expect((await beginRun(300, 2)).status).toBe('refused');
    expect((await db.query('select count(*)::integer n from qa_live_sessions where state=\'active\'')).rows[0]).toEqual({ n: 0 });
    const genuine = await beginRun(400);
    expect(genuine.status).toBe('started');
    expect((await beginRun(400)).status).toBe('resumed');
    expect((await db.query('select status,github_run_id from curated_verification_queue')).rows[0]).toEqual({ status: 'dispatched', github_run_id: null });
  });
});
