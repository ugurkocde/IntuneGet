import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

const id='11111111-1111-4111-8111-111111111111', hash='a'.repeat(64), profile='B'.repeat(64);
async function fixture() {
  const f=await historicalFixture();
  for (const n of ['20260714201549_installer_preflight_health','20261012153307_qa_installer_security_holds','20261016190552_qa_vt_coverage_holds_and_quota','20261016201507_qa_vt_positive_hold_upgrade','20261016210756_qa_vt_public_submission_bridge']) await f.pg.exec(f.read('../../supabase/migrations/'+n+'.sql'));
  if (!process.env.QA_VT_METADATA_BASELINE) await f.pg.exec(f.read('../../supabase/migrations/20261017005156_qa_vt_metadata_rechecks.sql'));
  await f.pg.query("insert into qa_candidates(id,status,test_level,installer_sha256,package_profile_sha256,github_run_id) values($1,'running','psadt-package',$2,$3,'12345')",[id,hash,profile]);
  return f;
}
async function pending(f: Awaited<ReturnType<typeof fixture>>) {
  const reservation=(await f.pg.query<{r:{reservationId:string}}>("select reserve_qa_vt_candidate_request('local-fixture-only',$1,$2,'hash_lookup') r",[id,hash])).rows[0].r.reservationId;
  await f.pg.query("select report_qa_vt_candidate_rate_limit('local-fixture-only',$1,$2,now()+interval '1 minute')",[id,reservation]);
  // Local fixture advances the due time; production callers cannot edit it.
  await f.pg.exec("update qa_vt_request_budget set blocked_until=null; update qa_vt_metadata_rechecks set retry_at=now()-interval '1 second'");
  await f.pg.query("update qa_candidates set status='error',phase='publishing',finished_at=now() where id=$1",[id]);
  return reservation;
}
const claim=(f:Awaited<ReturnType<typeof fixture>>,secret='local-fixture-only')=>f.pg.query<{r:{lease:string;reservationId:string;retryAt:string;stop:string;cached:boolean}}>('select claim_qa_vt_metadata_recheck($1) r',[secret]);

it('defers daily reservations through the same authenticated owner boundary without a seven-day clamp',async()=>{
  const f=await fixture();try {
    const lease='22222222-2222-4222-8222-222222222222', heldHash='b'.repeat(64);
    await f.pg.query("insert into qa_installer_security_holds(sha256,malicious_verdicts,recheck_lease,recheck_lease_expires_at) values($1,1,$2,now()+interval '2 minutes')",[heldHash,lease]);
    const reservation=(await f.pg.query<{r:{reservationId:string}}>("select reserve_qa_vt_candidate_request('local-fixture-only',$1,$2,'hash_lookup',$3) r",[id,heldHash,lease])).rows[0].r.reservationId;
    await expect(f.pg.query("select defer_qa_vt_candidate_requests_until('wrong',$1,$2,now()+interval '9 days')",[id,reservation])).rejects.toThrow('authentication');
    await expect(f.pg.query("select defer_qa_vt_candidate_requests_until('local-fixture-only',$1,$2,now()+interval '9 days')",[lease,reservation])).rejects.toThrow('owner');
    await f.pg.query("select defer_qa_vt_candidate_requests_until('local-fixture-only',$1,$2,now()+interval '9 days')",[id,reservation]);
    expect((await f.pg.query<{blocked:boolean}>("select blocked_until>now()+interval '8 days' blocked from qa_vt_request_budget")).rows[0].blocked).toBe(true);
    expect((await f.pg.query('select * from qa_vt_metadata_rechecks')).rows).toHaveLength(0);
    expect((await f.pg.query<{released_at:Date|null}>('select released_at from qa_installer_security_holds')).rows[0].released_at).toBeNull();
  }finally{await f.pg.close();}
},30000);

it('preserves a full absolute provider deadline beyond seven days',async()=>{
  const f=await fixture();try {
    const r=(await f.pg.query<{r:{reservationId:string}}>("select reserve_qa_vt_request($1,'hash_lookup') r",[hash])).rows[0].r;
    if(process.env.QA_VT_METADATA_BASELINE) await f.pg.query('select defer_qa_vt_requests($1,777600)',[r.reservationId]);
    else await f.pg.query("select defer_qa_vt_requests_until($1,now()+interval '9 days')",[r.reservationId]);
    expect((await f.pg.query<{blocked_until:Date}>('select blocked_until from qa_vt_request_budget')).rows[0].blocked_until.getTime()).toBeGreaterThan(Date.now()+8*86400000);
  }finally{await f.pg.close();}
},30000);

it('records only an authenticated owned lookup reservation, never a generic error',async()=>{
  const f=await fixture();try {
    await expect(f.pg.query("select report_qa_vt_candidate_rate_limit('wrong',$1,gen_random_uuid(),now()+interval '1 minute')",[id])).rejects.toThrow('authentication');
    await expect(f.pg.query("select report_qa_vt_candidate_rate_limit('local-fixture-only',$1,gen_random_uuid(),now()+interval '1 minute')",[id])).rejects.toThrow('binding');
    for(const role of ['anon','authenticated','service_role']) expect((await f.pg.query<{allowed:boolean}>("select has_table_privilege($1,'qa_vt_metadata_rechecks','INSERT') allowed",[role])).rows[0].allowed).toBe(false);
    expect((await f.pg.query('select * from qa_vt_metadata_rechecks')).rows).toHaveLength(0);
    await pending(f);expect((await f.pg.query('select * from qa_vt_metadata_rechecks')).rows).toHaveLength(1);
  }finally{await f.pg.close();}
},30000);

it('claims completed metadata without an active VM and rejects wrong or replayed leases',async()=>{
  const f=await fixture();try {
    await pending(f);await expect(claim(f,'wrong')).rejects.toThrow('authentication');
    const c=(await claim(f)).rows[0].r;expect(c.lease).toBeTruthy();expect(c.reservationId).toBeTruthy();
    expect((await claim(f)).rows[0].r.stop).toBe('no_eligible_work');
    await expect(f.pg.query("select complete_qa_vt_metadata_recheck('local-fixture-only',gen_random_uuid(),429)")).rejects.toThrow('lease');
    await f.pg.query("select complete_qa_vt_metadata_recheck('local-fixture-only',$1,429,now()+interval '9 days')",[c.lease]);
    const r=(await f.pg.query<{state:string;malicious:null;retry_at:Date}>("select * from qa_vt_metadata_rechecks")).rows[0];expect(r.state).toBe('pending');expect(r.malicious).toBeNull();expect(r.retry_at.getTime()).toBeGreaterThan(Date.now()+8*86400000);
    const b=(await f.pg.query<{blocked_until:Date}>('select * from qa_vt_request_budget')).rows[0];expect(b.blocked_until.getTime()).toBeGreaterThan(Date.now()+8*86400000);
    await expect(f.pg.query("select complete_qa_vt_metadata_recheck('local-fixture-only',$1,200,null,0,0,60,now())",[c.lease])).rejects.toThrow('lease');
  }finally{await f.pg.close();}
},30000);

it('uses a fresh covered hash cache without spending another reservation',async()=>{
  const f=await fixture();try {
    await pending(f);await f.pg.query("insert into catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,engine_count_version,analyzed_at,checked_at,retry_after) values($1,'found',0,0,60,2,now(),now(),now()+interval '1 day')",[hash]);
    expect((await claim(f)).rows[0].r.cached).toBe(true);expect((await f.pg.query('select * from qa_vt_requests')).rows).toHaveLength(1);
    expect((await f.pg.query<{state:string}>('select state from qa_vt_metadata_rechecks')).rows[0].state).toBe('resolved');
  }finally{await f.pg.close();}
},30000);

it('keeps newer positive evidence and does not turn a metadata resolution into a VM pass',async()=>{
  const f=await fixture();try {
    await pending(f);const c=(await claim(f)).rows[0].r;
    await f.pg.query("insert into catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,engine_count_version,analyzed_at,checked_at,retry_after) values($1,'found',2,0,60,2,now(),now(),now()+interval '1 day')",[hash]);
    await f.pg.query("select complete_qa_vt_metadata_recheck('local-fixture-only',$1,200,null,0,0,60,now()-interval '1 day')",[c.lease]);
    expect((await f.pg.query<{malicious:number}>('select malicious from qa_vt_metadata_rechecks')).rows[0].malicious).toBe(2);
    expect((await f.pg.query<{status:string}>('select status from qa_candidates')).rows[0].status).toBe('error');
  }finally{await f.pg.close();}
},30000);

it('stores covered metadata without changing a lifecycle result or superseded tuple',async()=>{
  const f=await fixture();try {
    await pending(f);
    await f.pg.query('update qa_candidates set package_profile_sha256=$1 where id=$2',['C'.repeat(64),id]);
    expect((await claim(f)).rows[0].r.stop).toBe('no_eligible_work');
    await f.pg.query('update qa_candidates set package_profile_sha256=$1 where id=$2',[profile,id]);
    const c=(await claim(f)).rows[0].r;
    await f.pg.query("select complete_qa_vt_metadata_recheck('local-fixture-only',$1,200,null,0,0,60,now())",[c.lease]);
    expect((await f.pg.query<{malicious:number}>('select malicious from catalog_file_reputation')).rows[0].malicious).toBe(0);
    expect((await f.pg.query<{state:string}>('select state from qa_vt_metadata_rechecks')).rows[0].state).toBe('resolved');
    expect((await f.pg.query<{status:string}>('select status from qa_candidates')).rows[0].status).toBe('error');
  }finally{await f.pg.close();}
},30000);

it('retains the four-per-minute and450 rolling budget, and spends timeouts',async()=>{
  const f=await fixture();try {
    await pending(f);
    for(let i=0;i<3;i++) await f.pg.query("select reserve_qa_vt_request($1,'analysis_lookup')",[hash]);
    const denied=(await claim(f)).rows[0].r;expect(denied.reservationId).toBeNull();expect(denied.retryAt).toBeTruthy();
    expect((await f.pg.query('select * from qa_vt_requests')).rows).toHaveLength(4);
    await f.pg.exec("update qa_vt_requests set reserved_at=now()-interval '2 minutes';update qa_vt_metadata_rechecks set retry_at=now()-interval '1 second'");
    const c=(await claim(f)).rows[0].r;expect(c.lease).toBeTruthy();
    await f.pg.exec("update qa_vt_metadata_rechecks set lease_expires_at=now()-interval '1 second'");
    expect((await claim(f)).rows[0].r.lease).toBeTruthy();expect((await f.pg.query('select * from qa_vt_requests')).rows).toHaveLength(6);
    await f.pg.exec("update qa_vt_metadata_rechecks set lease_expires_at=now()-interval '1 second';insert into qa_vt_requests(sha256,operation,reserved_at) select repeat('c',64),'hash_lookup',now()-interval '2 minutes' from generate_series(1,444)");
    const dayDenied=(await claim(f)).rows[0].r;expect(dayDenied.reservationId).toBeNull();expect((await f.pg.query('select * from qa_vt_requests')).rows).toHaveLength(450);
  }finally{await f.pg.close();}
},30000);

it('rejects malformed success, escalates exhausted work honestly, and reports metered usage',async()=>{
  const f=await fixture();try {
    await pending(f);const c=(await claim(f)).rows[0].r;
    await expect(f.pg.query("select complete_qa_vt_metadata_recheck('local-fixture-only',$1,200,null,0,0,0,now())",[c.lease])).rejects.toThrow('Invalid');
    await f.pg.exec("update qa_vt_metadata_rechecks set attempts=6,lease_expires_at=now()-interval '1 second'");
    expect((await claim(f)).rows[0].r.stop).toBe('no_eligible_work');
    const stats=(await f.pg.query<{r:{usedToday:number;used24h:number;providerDailyLimit:number;internalRollingCap:number;heldOnly429:number;escalated:number;untrackedBefore:Date;meteredReservationsOnly:boolean}}>("select qa_vt_request_stats('local-fixture-only') r")).rows[0].r;
    expect(stats.usedToday).toBe(2);expect(stats.used24h).toBe(2);expect(stats.providerDailyLimit).toBe(500);expect(stats.internalRollingCap).toBe(450);expect(stats.heldOnly429).toBe(1);expect(stats.escalated).toBe(1);expect(stats.untrackedBefore).toBeTruthy();expect(stats.meteredReservationsOnly).toBe(true);
    await expect(f.pg.query("select qa_vt_request_stats('wrong')")).rejects.toThrow('authentication');
  }finally{await f.pg.close();}
},30000);

it('keeps rerun429 deferral and separates metadata calls from VM lookup allowance',async()=>{
  const f=await fixture();try {
    await pending(f);const first=(await claim(f)).rows[0].r;
    await f.pg.exec("update qa_vt_metadata_rechecks set lease_expires_at=now()-interval '1 second'");
    await expect(f.pg.query("select complete_qa_vt_metadata_recheck('local-fixture-only',$1,200,null,0,0,60,now())",[first.lease])).rejects.toThrow('lease');
    await f.pg.query("select complete_qa_vt_metadata_recheck('local-fixture-only',$1,429,now()+interval '9 days')",[first.lease]);
    await f.pg.exec("update qa_vt_request_budget set blocked_until=null;update qa_candidates set status='running',github_run_id='67890',finished_at=null");
    const r=(await f.pg.query<{r:{reservationId:string}}>("select reserve_qa_vt_candidate_request('local-fixture-only',$1,$2,'hash_lookup') r",[id,hash])).rows[0].r;
    expect(r.reservationId).toBeTruthy();
    await f.pg.query("select report_qa_vt_candidate_rate_limit('local-fixture-only',$1,$2,now()+interval '9 days')",[id,r.reservationId]);
    expect((await f.pg.query('select * from qa_vt_metadata_rechecks')).rows).toHaveLength(2);
    expect((await f.pg.query<{blocked:boolean}>("select blocked_until>now()+interval '8 days' as blocked from qa_vt_request_budget")).rows[0].blocked).toBe(true);
    expect((await f.pg.query('select * from qa_vt_requests where metadata_candidate_id is not null and candidate_id is null')).rows).toHaveLength(1);
    await expect(f.pg.query("select report_qa_vt_candidate_rate_limit('local-fixture-only',$1,$2,now()+interval '1 day')",[id,first.reservationId])).rejects.toThrow('binding');
  }finally{await f.pg.close();}
},30000);

it('rejects implausible deadlines without truncating them and escalates old work',async()=>{
  const f=await fixture();try {
    await pending(f);const c=(await claim(f)).rows[0].r;
    await expect(f.pg.query("select complete_qa_vt_metadata_recheck('local-fixture-only',$1,429,'9999-12-31')",[c.lease])).rejects.toThrow('Invalid');
    expect((await f.pg.query<{state:string}>('select state from qa_vt_metadata_rechecks')).rows[0].state).toBe('leased');
    expect((await f.pg.query<{blocked_until:Date|null}>('select blocked_until from qa_vt_request_budget')).rows[0].blocked_until).toBeNull();
    await f.pg.exec("update qa_vt_metadata_rechecks set first_queued_at=now()-interval '15 days',lease_expires_at=now()-interval '1 second'");
    expect((await claim(f)).rows[0].r.stop).toBe('no_eligible_work');
    expect((await f.pg.query<{state:string}>('select state from qa_vt_metadata_rechecks')).rows[0].state).toBe('escalated');
  }finally{await f.pg.close();}
},30000);

it('lets only the existing security refresh consume a newly covered clean cache',async()=>{
  const f=await fixture();try {
    await pending(f);
    await f.pg.exec("update qa_candidates set status='running',phase='scanning_installer'");
    await f.pg.query("select report_qa_candidate_result('local-fixture-only',$1,'error','VirusTotal: awaiting engine coverage, rechecking daily')",[id]);
    await f.pg.exec("update qa_candidates set phase='publishing',finished_at=now()");
    const c=(await claim(f)).rows[0].r;
    await f.pg.query("select complete_qa_vt_metadata_recheck('local-fixture-only',$1,200,null,0,0,60,now())",[c.lease]);
    expect((await f.pg.query<{released_at:Date|null}>('select released_at from qa_installer_security_holds')).rows[0].released_at).toBeNull();
    expect((await f.pg.query<{status:string}>('select status from qa_candidates')).rows[0].status).toBe('error');
    await f.pg.query('select refresh_qa_installer_security_holds()');
    expect((await f.pg.query<{released_at:Date|null}>('select released_at from qa_installer_security_holds')).rows[0].released_at).toBeNull();
    // Advance the existing daily hold window in the fixture only.
    await f.pg.exec("update qa_installer_security_holds set next_check_at=now()-interval '1 second',verdict_at=now()-interval '1 minute',checked_at=null");
    await f.pg.query('select refresh_qa_installer_security_holds()');
    expect((await f.pg.query<{released_at:Date|null}>('select released_at from qa_installer_security_holds')).rows[0].released_at).toBeTruthy();
    expect((await f.pg.query<{status:string}>('select status from qa_candidates')).rows[0].status).toBe('queued');
  }finally{await f.pg.close();}
},30000);
