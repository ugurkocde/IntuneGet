import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

const id='11111111-1111-4111-8111-111111111111',hash='a'.repeat(64),profile='B'.repeat(64),secret='local-fixture-only';
async function fixture(){
  const f=await historicalFixture();
  for(const n of ['20260714201549_installer_preflight_health','20261012153307_qa_installer_security_holds','20261016190552_qa_vt_coverage_holds_and_quota','20261016201507_qa_vt_positive_hold_upgrade','20261016210756_qa_vt_public_submission_bridge','20261017005156_qa_vt_metadata_rechecks','20261017032327_qa_vt_ledger_acl','20261017142911_qa_vt_submission_dispatch_binding']) await f.pg.exec(f.read('../../supabase/migrations/'+n+'.sql'));
  await f.pg.exec(f.read('../../supabase/migrations/20261017150846_qa_vt_terminal_lookup_proof.sql'));
  if(!process.env.QA_VT_VERDICT_BASELINE)await f.pg.exec(f.read('../../supabase/migrations/20261017152014_qa_vt_terminal_verdict_completion.sql'));
  await f.pg.query("insert into qa_candidates(id,status,test_level,winget_id,version,architecture,installer_sha256,installer_url,package_profile_sha256,attempts,dispatched_at,enqueued_at,github_run_id) values($1,'dispatched','psadt-package','Example.App','1','x64',$2,'https://example.test/public.exe',$3,1,now()-interval '1 minute',now()-interval '2 minutes','12345')",[id,hash,profile]);
  await f.pg.query("insert into installer_health(cache_key,winget_id,version,architecture,installer_url,expected_sha256,actual_sha256,status,checked_at,expires_at) values('verified','Example.App','1','x64','https://example.test/public.exe',upper($1),upper($1),'healthy',now()-interval '30 seconds',now()+interval '1 hour')",[hash]);
  await f.pg.query("select record_qa_vt_submission_intent($1,'verified','https://example.test/public.exe')",[id]);
  await f.pg.query("update qa_candidates set status='error',phase='publishing',finished_at=now() where id=$1",[id]);
  return f;
}
type F=Awaited<ReturnType<typeof fixture>>;
const reserve=(f:F,op='hash_lookup')=>f.pg.query<{r:{reservationId:string;analysisId?:string}}>('select reserve_qa_vt_candidate_request($1,$2,$3,$4) r',[secret,id,hash,op]);
const complete=(f:F,r:string,status=200,analyzed:string|null=new Date().toISOString())=>f.pg.query('select complete_qa_vt_metadata_recheck($1,$2,$3,null,$4,$5,$6,$7)',[secret,r,status,status===200?0:null,status===200?0:null,status===200?60:null,status===200?analyzed:null]);
const claim=(f:F)=>f.pg.query<{r:{stop:string;nextAnalysis?:{candidateId:string;sha256:string};nextSubmission?:unknown;cached?:boolean;lease?:string;reservationId?:string}}>('select claim_qa_vt_metadata_recheck($1) r',[secret]);
async function submitted(f:F){await f.pg.exec("update qa_vt_submission_intents set outcome='submitted',analysis_id='opaque-analysis',upload_reserved_at=now()-interval '12 minutes',analysis_recorded_at=now()-interval '11 minutes'");}

it('records a terminal found verdict through the existing qualified cache writer without releasing holds',async()=>{
 const f=await fixture();try{
  await f.pg.query('insert into qa_installer_security_holds(sha256,malicious_verdicts) values($1,1)',[hash]);
  // The request was made before a concurrently observed positive hold appeared.
  await f.pg.exec('delete from qa_installer_security_holds');const r=(await reserve(f)).rows[0].r.reservationId;
  await f.pg.query('insert into qa_installer_security_holds(sha256,malicious_verdicts) values($1,1)',[hash]);
  await complete(f,r);
  expect((await f.pg.query('select status,total_engines,engine_count_version from catalog_file_reputation')).rows[0]).toEqual({status:'found',total_engines:60,engine_count_version:2});
  expect((await f.pg.query('select response_recorded_at is not null done from qa_vt_requests')).rows[0].done).toBe(true);
  await expect(complete(f,r)).rejects.toThrow('reservation');await expect(reserve(f,'upload_url')).rejects.toThrow('admission');
  expect((await f.pg.query('select malicious_verdicts,released_at from qa_installer_security_holds')).rows[0]).toEqual({malicious_verdicts:1,released_at:null});
  await f.pg.query("insert into qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at) values($1,$2,$3,'12345',now()-interval '1 second')",[id,hash,profile]);
  expect((await claim(f)).rows[0].r.cached).toBe(true);
 }finally{await f.pg.close();}
},30000);

it('rejects nonterminal, stale, future, leased, metadata and changed identity requests',async()=>{
 const f=await fixture();try{
  const r=(await reserve(f)).rows[0].r.reservationId;
  for(const change of ["candidate_id=gen_random_uuid()","sha256=repeat('b',64)","operation='upload'","recheck_lease=gen_random_uuid()","metadata_candidate_id=gen_random_uuid()","reserved_at=now()-interval '3 minutes'","reserved_at=now()+interval '1 minute'"]){
   await f.pg.exec('begin');try{await f.pg.query('update qa_vt_requests set '+change+' where id=$1',[r]);await expect(complete(f,r)).rejects.toThrow();}finally{await f.pg.exec('rollback');}
  }
  for(const change of ["finished_at=null,status='running'","github_run_id='99999'","package_profile_sha256=repeat('C',64)","attempts=2"]){
   await f.pg.exec('begin');try{await f.pg.query('update qa_candidates set '+change+' where id=$1',[id]);await expect(complete(f,r)).rejects.toThrow('identity');}finally{await f.pg.exec('rollback');}
  }
  await expect(f.pg.query("select complete_qa_vt_metadata_recheck('wrong',$1,200,null,0,0,60,now())",[r])).rejects.toThrow('authentication');
 }finally{await f.pg.close();}
},30000);

it('keeps hash404 and429 on their own writers and allows only one terminal response',async()=>{
 const f=await fixture();try{
  const r=(await reserve(f)).rows[0].r.reservationId;
  await expect(complete(f,r,404)).rejects.toThrow('status');await expect(complete(f,r,429)).rejects.toThrow('status');
  await f.pg.query("select record_qa_vt_submission_analysis($1,$2,$3,$4,'not_found')",[secret,id,hash,r]);
  await expect(complete(f,r)).rejects.toThrow('reservation');
  const second=(await reserve(f)).rows[0].r.reservationId;await complete(f,second,0);
  await expect(f.pg.query("select record_qa_vt_submission_analysis($1,$2,$3,$4,'not_found')",[secret,id,hash,second])).rejects.toThrow('reservation');
  expect((await f.pg.query('select * from catalog_file_reputation')).rows).toHaveLength(0);
 }finally{await f.pg.close();}
},30000);

it('selects a due exact analysis and records incomplete analysis without creating verdict evidence',async()=>{
 const f=await fixture();try{
  await submitted(f);expect((await claim(f)).rows[0].r).toEqual({stop:'no_eligible_work',nextAnalysis:{candidateId:id,sha256:hash}});
  const r=(await reserve(f,'analysis_lookup')).rows[0].r;expect(r.analysisId).toBe('opaque-analysis');
  await complete(f,r.reservationId,202);
  expect((await f.pg.query('select outcome,analysis_id from qa_vt_submission_intents')).rows[0]).toEqual({outcome:'submitted',analysis_id:'opaque-analysis'});
  expect((await f.pg.query('select * from catalog_file_reputation')).rows).toHaveLength(0);
  expect((await claim(f)).rows[0].r.nextAnalysis).toBeUndefined();
 }finally{await f.pg.close();}
},30000);

it('requires a completed analysis date consistent with upload and keeps counts validated',async()=>{
 const f=await fixture();try{
  await submitted(f);const r=(await reserve(f,'analysis_lookup')).rows[0].r.reservationId;
  await expect(complete(f,r,200,new Date(Date.now()-3600000).toISOString())).rejects.toThrow('date');
  await expect(complete(f,r,200,null)).rejects.toThrow('date');
  await expect(f.pg.query('select complete_qa_vt_metadata_recheck($1,$2,200,null,1,1,1,now())',[secret,r])).rejects.toThrow('Invalid');
  await complete(f,r);
  expect((await claim(f)).rows[0].r.nextAnalysis).toBeUndefined();
 }finally{await f.pg.close();}
},30000);

it('suppresses analysis under the global hold, known cache, identity drift and exhausted polling budget',async()=>{
 const f=await fixture();try{
  await submitted(f);
  for(const sql of ["update qa_vt_request_budget set blocked_until=now()+interval '9 days'","insert into catalog_file_reputation(sha256,status) values(repeat('a',64),'found')","update qa_candidates set github_run_id='99999'","update qa_vt_submission_intents set analysis_recorded_at=now()"]){
   await f.pg.exec('begin');try{await f.pg.exec(sql);expect((await claim(f)).rows[0].r.nextAnalysis).toBeUndefined();}finally{await f.pg.exec('rollback');}
  }
  await f.pg.query("insert into qa_vt_requests(sha256,candidate_id,operation,reserved_at) select $1,$2,'analysis_lookup',now()-interval '11 minutes' from generate_series(1,3)",[hash,id]);
  expect((await claim(f)).rows[0].r.nextAnalysis).toBeUndefined();
  const stats=(await f.pg.query<{r:{analysisBudgetExhausted:number}}>('select qa_vt_request_stats($1) r',[secret])).rows[0].r;expect(stats.analysisBudgetExhausted).toBe(1);
 }finally{await f.pg.close();}
},30000);

it('preserves the real metadata lease path and rejects its reservation id as an alternate lease',async()=>{
 const f=await fixture();try{
  await f.pg.query("insert into qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at) values($1,$2,$3,'12345',now()-interval '1 second')",[id,hash,profile]);
  const c=(await claim(f)).rows[0].r;expect(c.lease).toBeTruthy();await expect(complete(f,c.reservationId!)).rejects.toThrow('reservation');
  await f.pg.exec("update qa_vt_metadata_rechecks set lease_expires_at=now()-interval '1 second'");await expect(complete(f,c.lease!)).rejects.toThrow('lease');
  await f.pg.exec("update qa_vt_metadata_rechecks set lease_expires_at=now()+interval '1 minute'");await complete(f,c.lease!);await expect(complete(f,c.lease!)).rejects.toThrow('reservation');
  expect((await f.pg.query<{v:boolean}>("select has_table_privilege('service_role','qa_vt_requests','UPDATE') v")).rows[0].v).toBe(false);
  for(const role of ['anon','authenticated'])expect((await f.pg.query<{v:boolean}>("select has_table_privilege($1,'qa_vt_requests','SELECT') v",[role])).rows[0].v).toBe(false);
 }finally{await f.pg.close();}
},30000);

it('preserves newer positive cache evidence and rolls back completion when that cache is unqualified',async()=>{
 const f=await fixture();try{
  const r=(await reserve(f)).rows[0].r.reservationId;
  await f.pg.exec("insert into catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,engine_count_version,analyzed_at,checked_at,retry_after) values(repeat('a',64),'found',2,0,60,2,now()-interval '20 seconds',now(),now()+interval '1 day')");
  await complete(f,r,200,new Date(Date.now()-60000).toISOString());
  expect((await f.pg.query('select malicious from catalog_file_reputation')).rows[0].malicious).toBe(2);
  await f.pg.exec("delete from catalog_file_reputation;update qa_vt_requests set response_recorded_at=null;insert into catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,engine_count_version,analyzed_at,checked_at,retry_after) values(repeat('a',64),'found',2,0,60,2,now()+interval '1 day',now(),now()+interval '2 days')");
  await expect(complete(f,r)).rejects.toThrow('not qualified');
  expect((await f.pg.query('select response_recorded_at from qa_vt_requests')).rows[0].response_recorded_at).toBeNull();
  expect((await f.pg.query('select malicious from catalog_file_reputation')).rows[0].malicious).toBe(2);
 }finally{await f.pg.close();}
},30000);

it('rejects an analysis response after its stored analysis identity was rebound',async()=>{
 const f=await fixture();try{
  await submitted(f);const r=(await reserve(f,'analysis_lookup')).rows[0].r.reservationId;
  await f.pg.exec("update qa_vt_submission_intents set analysis_id='new-analysis',analysis_recorded_at=now()+interval '1 second'");
  await expect(complete(f,r)).rejects.toThrow('identity');
  expect((await f.pg.query('select response_recorded_at from qa_vt_requests')).rows[0].response_recorded_at).toBeNull();
 }finally{await f.pg.close();}
},30000);
