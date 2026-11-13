import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let db: PGlite;
const pin = 'a'.repeat(40), ordinaryId = '10000000-0000-4000-8000-000000000001';
const configId = '20000000-0000-4000-8000-000000000001';
const hold = { schemaVersion: 2, holdType: 'failed_config_requires_classification', runId: '42', attempt: 1,
  configVerificationId: configId, conclusion: 'failure', reason: 'GitHub run concluded failure; classification required.' };
const migration = '20261113201947_qa_curated_customer_fairness.sql';
const claim = async (kind: string, id: string) => (await db.query<{ result: { row?: { id: string }; reason?: string; queue?: string } }>(
  'select claim_qa_work($1,$2,$3) result', [kind, id, pin])).rows[0].result;
const queued = async (key: string, app = 'chrome', version = '1') => (await db.query<{ id: string }>(
  "insert into curated_verification_queue(verification_key,app_id,version,kind,inputs) values($1,$2,$3,'config','{}') returning id", [key,app,version])).rows[0].id;
const ordinary = async (priority = 0) => db.query("insert into qa_candidates(id,status,priority,enqueued_at,next_retry_at,test_level,demand_source) values($1,'queued',$2,now()-interval '1 day',now(),'psadt-package','customer')", [ordinaryId,priority]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table qa_pipeline_control(id text primary key,paused boolean,required_packager_commit text,scheduler_packager_commit text,scheduler_seen_at timestamptz);
    create table qa_candidates(id uuid primary key,status text,priority int,enqueued_at timestamptz,next_retry_at timestamptz,test_level text,demand_source text,
      attempts int default 0,dispatched_at timestamptz,phase text,phase_started_at timestamptz,phase_updated_at timestamptz,failure_summary text,updated_at timestamptz,
      winget_id text,version text,architecture text,installer_sha256 text);
    create table curated_qa_runs(github_run_id text,github_run_attempt int,kind text,config_verification_id uuid,app_id text,tested_version text,candidate_id text,outcome text,package_profile_sha256 text,packager_commit text);
    create table packaging_jobs(status text,archived_at timestamptz);
    create table qa_installer_security_holds(sha256 text,released_at timestamptz);
    create table qa_package_blocks(winget_id text,version text,architecture text,installer_sha256 text);
    create table qa_retest_grants(candidate_id uuid primary key,eligible boolean);
    create function qa_retest_grant_eligible(p uuid) returns boolean language sql as $$select coalesce((select eligible from public.qa_retest_grants where candidate_id=p),false)$$;
    create function qa_curated_installer_security_held(p jsonb) returns boolean language sql as $$select coalesce((p->>'securityHeld')::boolean,false)$$;
    grant all on qa_pipeline_control,qa_candidates,curated_qa_runs to service_role;`);
  for (const name of ['20261005193149_curated_priority_queue.sql','20261016010507_curated_reviewed_tuple_hold.sql'])
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url),'utf8'));
  await db.exec(`create function next_qa_curated_security_eligible() returns jsonb language sql as $$select to_jsonb(q) from curated_verification_queue q where status='queued' and not qa_curated_installer_security_held(inputs) order by priority desc,enqueued_at,id limit 1$$;`);
  if (process.env.QA_FAIRNESS_BASELINE !== '1') await db.exec(await readFile(new URL(`../../supabase/migrations/${migration}`,import.meta.url),'utf8'));
  else await db.exec('alter table qa_pipeline_control add column last_dispatch_kind text');
},30000);
beforeEach(async () => {
  await db.exec('truncate curated_verification_queue,qa_candidates,curated_qa_runs,qa_pipeline_control,packaging_jobs,qa_installer_security_holds,qa_package_blocks,qa_retest_grants');
  await db.query("insert into qa_pipeline_control(id,paused,required_packager_commit,scheduler_packager_commit,scheduler_seen_at,last_dispatch_kind)values('global',false,$1,$1,now(),'curated')",[pin]);
});
afterAll(async () => db?.close());
describe('curated classification and customer slot fairness', () => {
  it('gives ordinary the slot after curated, then permits curated after ordinary', async () => {
    await ordinary();const id=await queued(`config:${configId}`);await db.exec("insert into packaging_jobs values('awaiting_qa',null)");
    expect(await claim('curated',id)).toMatchObject({reason:'higher_priority_work',queue:'ordinary'});
    expect(await claim('ordinary',ordinaryId)).toMatchObject({row:{id:ordinaryId}});
    expect((await db.query<{ last_dispatch_kind: string }>("select last_dispatch_kind from qa_pipeline_control where id='global'")).rows[0].last_dispatch_kind).toBe('ordinary');
    await db.exec("update qa_candidates set status='passed'");
    expect(await claim('curated',id)).toMatchObject({row:{id}});
  });
  it('retains the old priority order when no customer awaits QA', async () => {
    await ordinary();const id=await queued(`config:${configId}`);
    expect(await claim('curated',id)).toMatchObject({row:{id}});
  });
  it('keeps the last dispatch kind when reconciliation clears old dispatch timestamps', async () => {
    await db.exec("update qa_pipeline_control set last_dispatch_kind='ordinary'");
    const first=await queued(`config:${configId}`);
    expect(await claim('curated',first)).toMatchObject({row:{id:first}});
    await db.query("update curated_verification_queue set status='completed',dispatched_at=null where id=$1",[first]);
    await ordinary();const next=await queued('config:20000000-0000-4000-8000-000000000002');
    await db.exec("insert into packaging_jobs values('awaiting_qa',null)");
    expect(await claim('curated',next)).toMatchObject({reason:'higher_priority_work',queue:'ordinary'});
    expect(await claim('ordinary',ordinaryId)).toMatchObject({row:{id:ordinaryId}});
  });
  it('does not strand curated behind an ordinary row blocked without a grant', async () => {
    await ordinary(3000);const id=await queued(`config:${configId}`);
    await db.exec(`insert into packaging_jobs values('awaiting_qa',null);insert into qa_retest_grants values('${ordinaryId}',false)`);
    expect(await claim('curated',id)).toMatchObject({row:{id}});
  });
  it('keeps failed configs held through cooldown, history loss and changed inputs', async () => {
    const id=await queued(`config:${configId}`);
    await db.query("update curated_verification_queue set status='held',hold=$1,github_run_id='42'where id=$2",[hold,id]);
    const before=(await db.query('select *from curated_verification_queue where id=$1',[id])).rows[0];
    await db.exec('delete from curated_qa_runs');
    expect((await db.query<{ result: unknown }>("select enqueue_curated_verification($1,'chrome','1','config','{\"changed\":true}')result",[`config:${configId}`])).rows[0].result).toEqual({held:true,reason:'failed_config_requires_classification'});
    expect((await db.query('select *from curated_verification_queue where id=$1',[id])).rows[0]).toEqual(before);
  });
  it('skips same-version siblings in both selection and claiming, but allows another version', async () => {
    const held=await queued(`config:${configId}`);await db.query("update curated_verification_queue set status='held',hold=$1 where id=$2",[hold,held]);
    const sibling=await queued('config:20000000-0000-4000-8000-000000000002');
    const next=await queued('config:20000000-0000-4000-8000-000000000003','chrome','2');
    expect((await db.query<{ result: { id: string } }>('select next_qa_curated_security_eligible()result')).rows[0].result.id).toBe(next);
    expect(await claim('curated',sibling)).toMatchObject({reason:'higher_priority_work'});
    expect(await claim('curated',next)).toMatchObject({row:{id:next}});
  });
  it.each([{...hold,reviewRef:'fake'},{...hold,profileSha256:'b'.repeat(64)},{...hold,conclusion:'success'}])('rejects false or extra runtime hold metadata', async value => {
    expect((await db.query<{ valid: boolean }>('select curated_verification_hold_valid($1)valid',[value])).rows[0].valid).toBe(false);
  });
  it('pins a runtime hold to the exact config key and forbids release rows', async () => {
    const id=await queued('config:20000000-0000-4000-8000-000000000002');
    await expect(db.query("update curated_verification_queue set status='held',hold=$1 where id=$2",[hold,id])).rejects.toThrow();
    await expect(db.query("insert into curated_verification_queue(verification_key,app_id,version,kind,inputs,status,hold)values('release:x','chrome','1','release','{}','held',$1)",[hold])).rejects.toThrow();
  });
  it('retains the pin, heartbeat, global control and active-run gates', async () => {
    await ordinary();
    expect((await db.query<{ result:{reason:string} }>('select claim_qa_work($1,$2,$3)result',['ordinary',ordinaryId,'wrong'])).rows[0].result.reason).toBe('packager_release_pending');
    await db.exec("update qa_pipeline_control set paused=true");
    expect(await claim('ordinary',ordinaryId)).toMatchObject({reason:'maintenance_paused'});
    await db.exec("update qa_pipeline_control set paused=false,scheduler_seen_at=now()-interval '16 minutes'");
    expect(await claim('ordinary',ordinaryId)).toMatchObject({reason:'packager_release_pending'});
    await db.exec("update qa_pipeline_control set scheduler_seen_at=now();update qa_candidates set status='running'");
    expect(await claim('ordinary',ordinaryId)).toMatchObject({reason:'qa_active'});
  });
  it('never boosts a security-held ordinary installer or claims a held curated installer', async () => {
    await ordinary();const id=await queued(`config:${configId}`);
    await db.exec("insert into packaging_jobs values('awaiting_qa',null);update qa_candidates set installer_sha256='bad';insert into qa_installer_security_holds values('bad',null)");
    expect(await claim('ordinary',ordinaryId)).toMatchObject({reason:'higher_priority_work',queue:'curated'});
    await db.query("update curated_verification_queue set inputs='{\"securityHeld\":true}'where id=$1",[id]);
    expect(await claim('curated',id)).toMatchObject({reason:'queue_empty'});
  });
});
