import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

const id='11111111-1111-4111-8111-111111111111',hash='a'.repeat(64),profile='B'.repeat(64),secret='local-fixture-only';
async function fixture(){
  const f=await historicalFixture();
  for(const n of ['20260714201549_installer_preflight_health','20261012153307_qa_installer_security_holds','20261016190552_qa_vt_coverage_holds_and_quota','20261016201507_qa_vt_positive_hold_upgrade','20261016210756_qa_vt_public_submission_bridge','20261017005156_qa_vt_metadata_rechecks','20261017032327_qa_vt_ledger_acl','20261017142911_qa_vt_submission_dispatch_binding']) await f.pg.exec(f.read('../../supabase/migrations/'+n+'.sql'));
  if(!process.env.QA_VT_PROOF_BASELINE)await f.pg.exec(f.read('../../supabase/migrations/20261017162556_qa_vt_terminal_lookup_proof.sql'));
  await f.pg.query("insert into qa_candidates(id,status,test_level,winget_id,version,architecture,installer_sha256,installer_url,package_profile_sha256,attempts,dispatched_at,enqueued_at,github_run_id) values($1,'dispatched','psadt-package','Example.App','1','x64',$2,'https://example.test/public.exe',$3,1,now()-interval '1 minute',now()-interval '2 minutes','12345')",[id,hash,profile]);
  await f.pg.query("insert into installer_health(cache_key,winget_id,version,architecture,installer_url,expected_sha256,actual_sha256,status,checked_at,expires_at) values('verified','Example.App','1','x64','https://example.test/public.exe',upper($1),upper($1),'healthy',now()-interval '30 seconds',now()+interval '1 hour')",[hash]);
  await f.pg.query("select record_qa_vt_submission_intent($1,'verified','https://example.test/public.exe')",[id]);
  await f.pg.query("update qa_candidates set status='error',phase='publishing',finished_at=now() where id=$1",[id]);
  return f;
}
type F=Awaited<ReturnType<typeof fixture>>;
const reserve=(f:F,op='hash_lookup')=>f.pg.query<{r:{reservationId:string|null}}>('select reserve_qa_vt_candidate_request($1,$2,$3,$4) r',[secret,id,hash,op]);
const proof=(f:F,r:string)=>f.pg.query("select record_qa_vt_submission_analysis($1,$2,$3,$4,'not_found')",[secret,id,hash,r]);
const claim=(f:F)=>f.pg.query<{r:{stop:string;nextSubmission?:{candidateId:string};lease?:string}}>('select claim_qa_vt_metadata_recheck($1) r',[secret]);
async function ready(f:F){const r=(await reserve(f)).rows[0].r.reservationId!;await proof(f,r);return r;}

it('requires a reserved provider404 before upload and preserves holds and immutable request accounting',async()=>{
  const f=await fixture();try{
    await f.pg.query('insert into qa_installer_security_holds(sha256,malicious_verdicts) values($1,0)',[hash]);
    await expect(reserve(f,'upload_url')).rejects.toThrow('provider404');
    await expect(reserve(f,'upload')).rejects.toThrow('provider404');
    const r=await ready(f);await expect(proof(f,r)).rejects.toThrow('reservation');
    expect((await reserve(f,'upload_url')).rows[0].r.reservationId).toBeTruthy();
    expect((await reserve(f,'upload')).rows[0].r.reservationId).toBeTruthy();
    await f.pg.query("select record_qa_vt_submission_analysis($1,$2,$3,null,'ambiguous')",[secret,id,hash]);
    await expect(reserve(f,'upload')).rejects.toThrow();
    expect((await f.pg.query('select count(*)::int n from qa_vt_requests')).rows[0].n).toBe(3);
    expect((await f.pg.query('select malicious_verdicts,released_at from qa_installer_security_holds')).rows[0]).toEqual({malicious_verdicts:0,released_at:null});
  }finally{await f.pg.close();}
},30000);

it('gives terminal proof its own two-request cap and skips exhausted oldest intents',async()=>{
  const f=await fixture();try{
    await f.pg.query("insert into qa_vt_requests(sha256,candidate_id,operation,reserved_at) select $1,$2,'hash_lookup',now()-interval '2 minutes' from generate_series(1,2)",[hash,id]);
    expect((await claim(f)).rows[0].r.nextSubmission?.candidateId).toBe(id);
    await reserve(f);await reserve(f);
    await expect(reserve(f)).rejects.toThrow('budget exhausted');
    expect((await claim(f)).rows[0].r.nextSubmission).toBeUndefined();
    const other='22222222-2222-4222-8222-222222222222';
    await f.pg.query("insert into qa_candidates(id,status,test_level,winget_id,version,architecture,installer_sha256,installer_url,package_profile_sha256,attempts,dispatched_at,enqueued_at,github_run_id,phase,finished_at) select $1,status,test_level,'Other.App',version,architecture,repeat('b',64),installer_url,package_profile_sha256,attempts,dispatched_at,enqueued_at,github_run_id,phase,finished_at from qa_candidates where id=$2",[other,id]);
    await f.pg.query("insert into qa_vt_submission_intents(sha256,candidate_id,winget_id,version,architecture,manifest_installer_url,execution_installer_url,preflight_cache_key,verified_at,dispatch_started_at,dispatch_attempt,profile_sha256,github_run_id) select repeat('b',64),$1,'Other.App',version,architecture,manifest_installer_url,execution_installer_url,preflight_cache_key,verified_at,dispatch_started_at,dispatch_attempt,profile_sha256,github_run_id from qa_vt_submission_intents where sha256=$2",[other,hash]);
    expect((await claim(f)).rows[0].r.nextSubmission?.candidateId).toBe(other);
    expect((await f.pg.query('select count(*)::int n from qa_vt_requests')).rows[0].n).toBe(4);
  }finally{await f.pg.close();}
},30000);

it('measures proof freshness from reservation time, rejects older replay and honors deferral between upload stages',async()=>{
  const f=await fixture();try{
    const first=await ready(f),second=await ready(f);
    await expect(proof(f,first)).rejects.toThrow('reservation');
    expect((await f.pg.query('select hash_lookup_reservation_id from qa_vt_submission_intents')).rows[0].hash_lookup_reservation_id).toBe(second);
    await f.pg.exec('begin');try{
      await f.pg.exec("update qa_vt_submission_intents set hash_not_found_at=now()-interval '6 minutes'");
      await expect(reserve(f,'upload_url')).rejects.toThrow('provider404');
    }finally{await f.pg.exec('rollback');}
    await reserve(f,'upload_url');
    await f.pg.exec("update qa_vt_request_budget set blocked_until=now()+interval '9 days'");
    expect((await reserve(f,'upload')).rows[0].r.reservationId).toBeNull();
    expect((await f.pg.query('select upload_reserved_at from qa_vt_submission_intents')).rows[0].upload_reserved_at).toBeNull();
    expect((await claim(f)).rows[0].r.nextSubmission).toBeUndefined();
    await f.pg.exec('update qa_vt_request_budget set blocked_until=null');
    expect((await reserve(f,'upload')).rows[0].r.reservationId).toBeTruthy();
    expect((await f.pg.query('select count(*)::int n from qa_vt_requests')).rows[0].n).toBe(4);
  }finally{await f.pg.close();}
},30000);

it('rejects foreign, leased, metadata, stale, future and pre-provenance reservations',async()=>{
  const f=await fixture();try{
    const r=(await reserve(f)).rows[0].r.reservationId!;
    for(const change of ["candidate_id=gen_random_uuid()","sha256=repeat('b',64)","operation='analysis_lookup'","recheck_lease=gen_random_uuid()","metadata_candidate_id=gen_random_uuid()","reserved_at=now()-interval '6 minutes'","reserved_at=now()+interval '1 minute'","reserved_at=now()-interval '40 seconds'"]){
      await f.pg.exec('begin');try{await f.pg.query('update qa_vt_requests set '+change+' where id=$1',[r]);await expect(proof(f,r)).rejects.toThrow('reservation');}finally{await f.pg.exec('rollback');}
    }
    await proof(f,r);
  }finally{await f.pg.close();}
},30000);

it('clears proof on trusted provenance refresh and rejects changed run, attempt and profile',async()=>{
  const f=await fixture();try{
    await ready(f);
    for(const change of ["github_run_id='99999'","attempts=2","package_profile_sha256=repeat('C',64)"]){
      await f.pg.exec('begin');try{await f.pg.query('update qa_candidates set '+change+' where id=$1',[id]);await expect(reserve(f,'upload_url')).rejects.toThrow();}finally{await f.pg.exec('rollback');}
    }
    await f.pg.query("update qa_candidates set status='dispatched',dispatched_at=now() where id=$1",[id]);
    await f.pg.query("select record_qa_vt_submission_intent($1,'verified','https://example.test/public.exe')",[id]);
    expect((await f.pg.query('select hash_lookup_reservation_id,hash_not_found_at from qa_vt_submission_intents')).rows[0]).toEqual({hash_lookup_reservation_id:null,hash_not_found_at:null});
    await expect(reserve(f,'upload_url')).rejects.toThrow('provider404');
  }finally{await f.pg.close();}
},30000);

it('denies known-found or positive holds after proof, and never resumes a stranded upload URL',async()=>{
  const f=await fixture();try{
    await ready(f);
    for(const sql of ["insert into catalog_file_reputation(sha256,status) values(repeat('a',64),'found')","insert into qa_installer_security_holds(sha256,malicious_verdicts) values(repeat('a',64),1)"]){
      await f.pg.exec('begin');try{await f.pg.exec(sql);await expect(reserve(f,'upload_url')).rejects.toThrow('admission');}finally{await f.pg.exec('rollback');}
    }
    await reserve(f,'upload_url');
    await f.pg.exec("update qa_vt_submission_intents set upload_url_reserved_at=now()-interval '11 minutes'");
    await expect(reserve(f,'upload')).rejects.toThrow('provider404');
    expect((await claim(f)).rows[0].r.nextSubmission).toBeUndefined();
    expect((await f.pg.query('select upload_reserved_at from qa_vt_submission_intents')).rows[0].upload_reserved_at).toBeNull();
  }finally{await f.pg.close();}
},30000);

it('keeps metadata priority, full provider deferral and the existing API grants',async()=>{
  const f=await fixture();try{
    await f.pg.query("insert into qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at) values($1,$2,$3,'12345',now()-interval '1 second')",[id,hash,profile]);
    expect((await claim(f)).rows[0].r.lease).toBeTruthy();
    await f.pg.exec("delete from qa_vt_metadata_rechecks;update qa_vt_request_budget set blocked_until=now()+interval '9 days'");
    expect((await reserve(f)).rows[0].r.reservationId).toBeNull();
    expect((await claim(f)).rows[0].r.nextSubmission).toBeUndefined();
    for(const role of ['anon','authenticated'])expect((await f.pg.query<{v:boolean}>("select has_table_privilege($1,'qa_vt_submission_intents','UPDATE') v",[role])).rows[0].v).toBe(false);
    expect((await f.pg.query<{v:boolean}>("select has_function_privilege('anon','record_qa_vt_submission_analysis(text,uuid,text,text,text)','EXECUTE') v")).rows[0].v).toBe(true);
  }finally{await f.pg.close();}
},30000);
