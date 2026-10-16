import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

const hash='a'.repeat(64), foreign='b'.repeat(64), id='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222', url='https://example.test/public.exe';
async function fixture() {
  const f=await historicalFixture();
  for (const n of ['20260714201549_installer_preflight_health','20261012153307_qa_installer_security_holds','20261016190552_qa_vt_coverage_holds_and_quota','20261016201507_qa_vt_positive_hold_upgrade']) await f.pg.exec(f.read('../../supabase/migrations/'+n+'.sql'));
  if (!process.env.QA_VT_BRIDGE_BASELINE) await f.pg.exec(f.read('../../supabase/migrations/20261016210756_qa_vt_public_submission_bridge.sql'));
  await f.pg.query("insert into qa_candidates(id,status,test_level,winget_id,version,architecture,installer_sha256,installer_url) values($1,'dispatched','psadt-package','Example.App','1','x64',$2,$3)",[id,hash,url]);
  await f.pg.query("insert into installer_health(cache_key,winget_id,version,architecture,installer_url,expected_sha256,actual_sha256,status,checked_at,expires_at) values('verified','Example.App','1','x64',$1,upper($2),upper($2),'healthy',now(),now()+interval '1 hour')",[url,hash]);
  return f;
}

it('requires server verified public provenance and preserves spent submission identity',async()=>{
  const {pg}=await fixture();
  try {
    const record=()=>pg.query('select record_qa_vt_submission_intent($1,$2,$3)',[id,'verified',url]);
    await pg.exec('set role anon');
    try {await expect(record()).rejects.toThrow('permission denied');}finally{await pg.exec('reset role');}
    for (const field of ["status='running'","winget_id='Custom.App'","winget_id='intuneget.curated.app'","version='2'","architecture='arm64'","installer_sha256=repeat('b',64)"]) {
      await pg.exec('begin');
      try {await pg.query('update qa_candidates set '+field+' where id=$1',[id]);await expect(record()).rejects.toThrow();}finally{await pg.exec('rollback');}
    }
    for (const field of ["status='error'","expires_at=now()-interval '1 second'","actual_sha256=repeat('B',64)","installer_url='https://example.test/other.exe'"]) {
      await pg.exec('begin');
      try {await pg.exec('update installer_health set '+field);await expect(record()).rejects.toThrow();}finally{await pg.exec('rollback');}
    }
    await pg.exec('set role service_role');try {await record();}finally{await pg.exec('reset role');}
    await pg.query("select reserve_qa_vt_candidate_request('local-fixture-only',$1,$2,'upload')",[id,hash]);
    await pg.query("select record_qa_vt_submission_analysis('local-fixture-only',$1,$2,null,'ambiguous')",[id,hash]);
    await record();
    const intent=(await pg.query<{outcome:string;upload_reserved_at:Date}>('select * from qa_vt_submission_intents')).rows[0];
    expect(intent.outcome).toBe('ambiguous');expect(intent.upload_reserved_at).toBeTruthy();
    await expect(pg.query("select reserve_qa_vt_candidate_request('local-fixture-only',$1,$2,'upload')",[id,hash])).rejects.toThrow('already reserved');
    await expect(pg.query("select record_qa_vt_submission_analysis('local-fixture-only',$1,$2,'opaque-id','submitted')",[id,hash])).rejects.toThrow();
    for (const role of ['anon','authenticated']) expect((await pg.query<{allowed:boolean}>("select has_table_privilege($1,'qa_vt_submission_intents','SELECT') allowed",[role])).rows[0].allowed).toBe(false);
  }finally{await pg.close();}
},30000);

it('binds each request to the active candidate, hash, operation and single-use recheck lease',async()=>{
  const {pg}=await fixture();
  try {
    const reserve=(h=hash,op='hash_lookup',lease:string|null=null,secret='local-fixture-only')=>pg.query<{r:{reservationId:string|null}}>('select reserve_qa_vt_candidate_request($1,$2,$3,$4,$5) r',[secret,id,h,op,lease]);
    await expect(reserve(hash,'hash_lookup',null,'wrong')).rejects.toThrow('authentication');
    await expect(reserve(foreign)).rejects.toThrow('hash rejected');
    await expect(reserve(hash,'upload')).rejects.toThrow('intent unavailable');
    await expect(reserve(hash,'arbitrary_url')).rejects.toThrow('binding rejected');
    await pg.query("insert into qa_installer_security_holds(sha256,malicious_verdicts,next_check_at) values($1,1,now()-interval '1 second')",[foreign]);
    await pg.query("insert into qa_candidates(id,status,test_level,installer_sha256) values($1,'error','psadt-package',$2)",[other,foreign]);
    const lease=(await pg.query<{r:{lease:string}[]}>("select claim_qa_installer_security_rechecks('local-fixture-only',$1,1) r",[id])).rows[0].r[0].lease;
    await expect(reserve(foreign,'upload',lease)).rejects.toThrow('lease rejected');
    expect((await reserve(foreign,'hash_lookup',lease)).rows[0].r.reservationId).toBeTruthy();
    await expect(reserve(foreign,'hash_lookup',lease)).rejects.toThrow('lease rejected');
    expect((await reserve()).rows[0].r.reservationId).toBeTruthy();
    expect((await reserve()).rows[0].r.reservationId).toBeTruthy();
    await expect(reserve()).rejects.toThrow('budget exhausted');
    await pg.query("update qa_candidates set status='error' where id=$1",[id]);
    await expect(reserve()).rejects.toThrow('binding rejected');
  }finally{await pg.close();}
},30000);

it('returns covered cache hits without spending and shares global Retry-After with service callers',async()=>{
  const {pg}=await fixture();
  try {
    await pg.query("insert into catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,engine_count_version,analyzed_at,checked_at,retry_after) values($1,'found',0,0,60,2,now(),now(),now()+interval '1 day')",[hash]);
    expect((await pg.query<{r:{cached:unknown}}>("select reserve_qa_vt_candidate_request('local-fixture-only',$1,$2,'hash_lookup') r",[id,hash])).rows[0].r.cached).toBeTruthy();
    expect((await pg.query('select * from qa_vt_requests')).rows).toHaveLength(0);
    await pg.exec('delete from catalog_file_reputation');
    const r=(await pg.query<{r:{reservationId:string}}>("select reserve_qa_vt_candidate_request('local-fixture-only',$1,$2,'hash_lookup') r",[id,hash])).rows[0].r;
    await expect(pg.query("select defer_qa_vt_candidate_requests('local-fixture-only',$1,$2,120)",[other,r.reservationId])).rejects.toThrow('owner rejected');
    await pg.query("select defer_qa_vt_candidate_requests('local-fixture-only',$1,$2,120)",[id,r.reservationId]);
    expect((await pg.query<{r:{reservationId:null;retryAt:string}}>("select reserve_qa_vt_request($1,'hash_lookup') r",[foreign])).rows[0].r).toMatchObject({reservationId:null,retryAt:expect.any(String)});
    expect((await pg.query('select * from qa_vt_requests')).rows).toHaveLength(1);
  }finally{await pg.close();}
},30000);

it('persists upload reservations before HTTP and binds analysis to the recorded opaque ID',async()=>{
  const {pg}=await fixture();
  try {
    await pg.query('select record_qa_vt_submission_intent($1,$2,$3)',[id,'verified',url]);
    const reserve=(op:string)=>pg.query<{r:{reservationId:string|null;installerUrl?:string;analysisId?:string}}>("select reserve_qa_vt_candidate_request('local-fixture-only',$1,$2,$3) r",[id,hash,op]);
    expect((await reserve('upload_url')).rows[0].r.installerUrl).toBe(url);
    await expect(reserve('upload_url')).rejects.toThrow('already reserved');
    expect((await reserve('upload')).rows[0].r.reservationId).toBeTruthy();
    await expect(reserve('upload')).rejects.toThrow('already reserved');
    await expect(pg.query("select record_qa_vt_submission_analysis('local-fixture-only',$1,$2,'https://untrusted.test','submitted')",[id,hash])).rejects.toThrow();
    await pg.query("select record_qa_vt_submission_analysis('local-fixture-only',$1,$2,'opaque-id_123=','submitted')",[id,hash]);
    expect((await reserve('analysis_lookup')).rows[0].r.analysisId).toBe('opaque-id_123=');
    // Exhaust the independent rolling minute budget; a denial spends nothing.
    await reserve('analysis_lookup');
    const denied=(await reserve('analysis_lookup')).rows[0].r;
    expect(denied.reservationId).toBeNull();
    expect((await pg.query('select * from qa_vt_requests')).rows).toHaveLength(4);
    await pg.exec("update qa_vt_requests set reserved_at=now()-interval '2 minutes'");
    expect((await reserve('analysis_lookup')).rows[0].r.reservationId).toBeTruthy();
    await expect(reserve('analysis_lookup')).rejects.toThrow('analysis unavailable');
  }finally{await pg.close();}
},30000);

it('seeds an unknown report from an already covered positive cache without weakening the exclusion',async()=>{
  const {pg}=await fixture();
  try {
    // Model a pre-existing cache with no corresponding exclusion row.
    await pg.query("insert into catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,analyzed_at,checked_at) values($1,'found',2,0,60,now()-interval '1 day',now())",[hash]);
    await pg.exec('delete from qa_installer_security_holds');
    await pg.query("update qa_candidates set status='running' where id=$1",[id]);
    await pg.query("select report_qa_candidate_result('local-fixture-only',$1,'error','VirusTotal: awaiting engine coverage, rechecking daily')",[id]);
    expect((await pg.query<{n:number}>('select malicious_verdicts n from qa_installer_security_holds')).rows[0].n).toBe(2);
    expect((await pg.query<{reason:string}>('select failure_summary reason from qa_candidates where id=$1',[id])).rows[0].reason).toBe('VirusTotal refused execution for this installer hash.');
  }finally{await pg.close();}
},30000);
