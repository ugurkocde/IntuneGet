import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

const id='11111111-1111-4111-8111-111111111111', hash='a'.repeat(64), profile='B'.repeat(64);
const url='https://example.test/public.exe', secret='local-fixture-only';
async function fixture() {
  const f=await historicalFixture();
  for(const n of ['20260714201549_installer_preflight_health','20261012153307_qa_installer_security_holds','20261016190552_qa_vt_coverage_holds_and_quota','20261016201507_qa_vt_positive_hold_upgrade','20261016210756_qa_vt_public_submission_bridge','20261017005156_qa_vt_metadata_rechecks','20261017032327_qa_vt_ledger_acl']) await f.pg.exec(f.read('../../supabase/migrations/'+n+'.sql'));
  if(!process.env.QA_VT_DISPATCH_BASELINE) await f.pg.exec(f.read('../../supabase/migrations/20261017140653_qa_vt_submission_dispatch_binding.sql'));
  await f.pg.query("insert into qa_candidates(id,status,test_level,winget_id,version,architecture,installer_sha256,installer_url,package_profile_sha256,attempts,dispatched_at,enqueued_at) values($1,'dispatched','psadt-package','Example.App','1','x64',$2,$3,$4,1,now(),now())",[id,hash,url,profile]);
  await f.pg.query("insert into installer_health(cache_key,winget_id,version,architecture,installer_url,expected_sha256,actual_sha256,status,checked_at,expires_at) values('verified','Example.App','1','x64',$1,upper($2),upper($2),'healthy',now(),now()+interval '1 hour')",[url,hash]);
  return f;
}
const intent=(f:Awaited<ReturnType<typeof fixture>>,u=url)=>f.pg.query('select record_qa_vt_submission_intent($1,$2,$3)',[id,'verified',u]);
const reserve=(f:Awaited<ReturnType<typeof fixture>>,op='upload')=>f.pg.query<{r:{reservationId:string;installerUrl:string}}>('select reserve_qa_vt_candidate_request($1,$2,$3,$4) r',[secret,id,hash,op]);
const claim=(f:Awaited<ReturnType<typeof fixture>>)=>f.pg.query<{r:{stop:string;nextSubmission?:{candidateId:string;sha256:string;installerUrl:string};lease?:string}}>('select claim_qa_vt_metadata_recheck($1) r',[secret]);
async function terminal(f:Awaited<ReturnType<typeof fixture>>) {
  await intent(f);
  await f.pg.query("update qa_candidates set github_run_id='12345',status='error',phase='publishing',finished_at=now() where id=$1",[id]);
}

it('preserves active candidate lookup and binds submissions after the workflow registers its run',async()=>{
  const f=await fixture();try {
    await intent(f);
    expect((await reserve(f,'hash_lookup')).rows[0].r.reservationId).toBeTruthy();
    await expect(reserve(f)).rejects.toThrow();
    await f.pg.query("update qa_candidates set github_run_id='12345',status='running' where id=$1",[id]);
    expect((await reserve(f)).rows[0].r.reservationId).toBeTruthy();
    await f.pg.query("select record_qa_vt_submission_analysis($1,$2,$3,null,'ambiguous')",[secret,id,hash]);
    expect((await f.pg.query('select outcome from qa_vt_submission_intents')).rows[0]).toEqual({outcome:'ambiguous'});
  }finally{await f.pg.close();}
},30000);

it('captures pre-dispatch provenance and submits the same completed run without changing its hold',async()=>{
  const f=await fixture();try {
    await terminal(f);
    await f.pg.query('insert into qa_installer_security_holds(sha256,malicious_verdicts) values($1,0)',[hash]);
    const c=(await claim(f)).rows[0].r;
    expect(c).toMatchObject({stop:'no_eligible_work',nextSubmission:{candidateId:id,sha256:hash,installerUrl:url}});
    expect((await f.pg.query('select * from qa_vt_requests')).rows).toHaveLength(0);
    const r=(await reserve(f)).rows[0].r;expect(r.reservationId).toBeTruthy();
    await f.pg.query("select record_qa_vt_submission_analysis($1,$2,$3,'opaque-analysis','submitted')",[secret,id,hash]);
    expect((await f.pg.query('select github_run_id,outcome from qa_vt_submission_intents')).rows[0]).toEqual({github_run_id:'12345',outcome:'submitted'});
    expect((await f.pg.query('select status from qa_candidates')).rows[0]).toEqual({status:'error'});
    expect((await f.pg.query('select malicious_verdicts,released_at from qa_installer_security_holds')).rows[0]).toEqual({malicious_verdicts:0,released_at:null});
    await expect(reserve(f)).rejects.toThrow();
  }finally{await f.pg.close();}
},30000);

it('rejects changed dispatch, attempt, run, profile, hash and superseded candidates without spending',async()=>{
  const f=await fixture();try {
    await terminal(f);
    for(const change of ["attempts=2","dispatched_at=dispatched_at+interval '1 second'","package_profile_sha256=repeat('C',64)","installer_sha256=repeat('d',64)","status='queued'","status='superseded'","installer_url='https://example.test/changed.exe'"]) {
      await f.pg.exec('begin');try {
        await f.pg.query('update qa_candidates set '+change+' where id=$1',[id]);
        expect((await claim(f)).rows[0].r.nextSubmission).toBeUndefined();
        await expect(reserve(f)).rejects.toThrow();
      }finally{await f.pg.exec('rollback');}
    }
    await reserve(f,'upload_url');
    await f.pg.query("update qa_candidates set github_run_id='67890' where id=$1",[id]);
    await expect(reserve(f)).rejects.toThrow();
    expect((await f.pg.query('select * from qa_vt_requests')).rows).toHaveLength(1);
  }finally{await f.pg.close();}
},30000);

it('rejects a newer source tuple, positive cache, positive hold, package block and stale provenance',async()=>{
  const f=await fixture();try {
    await terminal(f);
    const changes=[
      "insert into qa_candidates(id,status,test_level,winget_id,version,architecture,installer_sha256,enqueued_at) values(gen_random_uuid(),'queued','psadt-package','Example.App','2','x64',repeat('c',64),now()+interval '1 second')",
      "insert into catalog_file_reputation(sha256,status,malicious,suspicious) values(repeat('a',64),'found',0,1)",
      "insert into qa_installer_security_holds(sha256,malicious_verdicts) values(repeat('a',64),1)",
      "insert into qa_package_blocks(winget_id,version,architecture,installer_sha256) values('Example.App','1','x64',repeat('A',64))",
      "update qa_vt_submission_intents set verified_at=now()-interval '7 hours'",
      "update qa_vt_submission_intents set verified_at=now()+interval '1 hour'",
    ];
    for(const sql of changes) {
      await f.pg.exec('begin');try {
        await f.pg.exec(sql);expect((await claim(f)).rows[0].r.nextSubmission).toBeUndefined();
        await expect(reserve(f)).rejects.toThrow();
      }finally{await f.pg.exec('rollback');}
    }
    expect((await f.pg.query('select * from qa_vt_requests')).rows).toHaveLength(0);
  }finally{await f.pg.close();}
},30000);

it('keeps legacy and malformed URL intents ineligible and retains original API grants',async()=>{
  const f=await fixture();try {
    for(const u of ['https://127.0.0.1/a','https://[::1]/a','https://localhost/a','https://a.local/a','https://a.internal/a','https://user@example.test/a','https://example.test:444/a','http://example.test/a']) {
      await f.pg.query('update installer_health set installer_url=$1',[u]);await expect(intent(f,u)).rejects.toThrow();
    }
    await f.pg.query('update installer_health set installer_url=$1',[url]);await terminal(f);
    await f.pg.exec('update qa_vt_submission_intents set dispatch_started_at=null,dispatch_attempt=null,profile_sha256=null');
    expect((await claim(f)).rows[0].r.nextSubmission).toBeUndefined();await expect(reserve(f)).rejects.toThrow();
    for(const role of ['anon','authenticated']) for(const fn of ['qa_vt_submission_identity(uuid,text)','qa_vt_submission_admissible(text)']) {
      expect((await f.pg.query<{v:boolean}>('select has_function_privilege($1,$2,\'EXECUTE\') v',[role,fn])).rows[0].v).toBe(false);
    }
    expect((await f.pg.query<{v:boolean}>("select has_function_privilege('anon','claim_qa_vt_metadata_recheck(text)','EXECUTE') v")).rows[0].v).toBe(true);
  }finally{await f.pg.close();}
},30000);

it('prioritizes due metadata, stops under global deferral and never refunds ambiguous uploads',async()=>{
  const f=await fixture();try {
    await terminal(f);
    await f.pg.query("insert into qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at) values($1,$2,$3,'12345',now()-interval '1 second')",[id,hash,profile]);
    expect((await claim(f)).rows[0].r.lease).toBeTruthy();
    await f.pg.exec('delete from qa_vt_metadata_rechecks');
    await f.pg.exec("update qa_vt_request_budget set blocked_until=now()+interval '1 hour'");
    expect((await claim(f)).rows[0].r.nextSubmission).toBeUndefined();
    expect((await reserve(f)).rows[0].r.reservationId).toBeNull();
    await f.pg.exec('update qa_vt_request_budget set blocked_until=null');await reserve(f);
    await f.pg.query("select record_qa_vt_submission_analysis($1,$2,$3,null,'ambiguous')",[secret,id,hash]);
    await expect(reserve(f)).rejects.toThrow();expect((await f.pg.query('select * from qa_vt_requests')).rows).toHaveLength(2);
  }finally{await f.pg.close();}
},30000);
