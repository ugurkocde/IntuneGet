import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';
import { installerSecurityReason, loadInstallerSecurityHolds } from '../../lib/qa/installer-security-holds';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';

const summary = 'VirusTotal: awaiting engine coverage, rechecking daily';
const hash = 'a'.repeat(64), id = '11111111-1111-4111-8111-111111111111';
async function fixture() {
  const f = await historicalFixture();
  await f.pg.exec(f.read('../../supabase/migrations/20261012153307_qa_installer_security_holds.sql'));
  if (!process.env.QA_VT_COVERAGE_BASELINE) await f.pg.exec(f.read('../../supabase/migrations/20261016190552_qa_vt_coverage_holds_and_quota.sql'));
  await f.pg.query("insert into qa_candidates(id,status,test_level,installer_sha256,phase,attempts) values($1,'running','psadt-package',$2,'scanning_installer',2)", [id,hash]);
  return f;
}

it('holds an authenticated unknown report indefinitely and excludes ordinary and curated execution', async () => {
  const {pg} = await fixture();
  try {
    await expect(pg.query("select report_qa_candidate_result('wrong',$1,'error',$2)",[id,summary])).rejects.toThrow();
    expect((await pg.query('select * from qa_installer_security_holds')).rows).toHaveLength(0);
    await pg.query("select report_qa_candidate_result('local-fixture-only',$1,'error',$2)",[id,summary]);
    const held=(await pg.query<{malicious_verdicts:number;reason:string}>('select * from qa_installer_security_holds')).rows[0];
    expect(held).toMatchObject({malicious_verdicts:0,reason:summary});
    await expect(pg.query("update qa_candidates set status='dispatched' where id=$1",[id])).rejects.toThrow('Installer security hold');
    expect((await pg.query<{r:boolean}>('select qa_curated_installer_security_held($1) r',[{candidate:JSON.stringify({vendorSha256:hash})}])).rows[0].r).toBe(true);
    await pg.exec("update qa_installer_security_holds set first_held_at=now()-interval '2 days',next_check_at=now()-interval '1 day'");
    await pg.query("insert into catalog_file_reputation(sha256,status,checked_at) values($1,'not_found',now())",[hash]);
    await pg.query('select refresh_qa_installer_security_holds()');
    expect((await pg.query<{held:boolean}>('select released_at is null held from qa_installer_security_holds')).rows[0].held).toBe(true);
    expect((await pg.query<{attempts:number}>('select attempts from qa_candidates where id=$1',[id])).rows[0].attempts).toBe(2);
    for (const role of ['anon','authenticated']) expect((await pg.query<{allowed:boolean}>("select has_table_privilege($1,'qa_installer_security_holds','SELECT') allowed",[role])).rows[0].allowed).toBe(false);
  } finally {await pg.close();}
},30000);

it('never downgrades an active flagged hold and releases unknown only on a newer covered verdict', async () => {
  const {pg}=await fixture();
  try {
    await pg.query("select report_qa_candidate_result('local-fixture-only',$1,'error',$2)",[id,summary]);
    // A cached unknown, stale clean or zero-coverage result cannot release it.
    for (const total of [null,0,60]) {
      await pg.query("insert into catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,analyzed_at,checked_at) values($1,'found',0,0,$2,now()-interval '1 day',now()) on conflict(sha256) do update set total_engines=excluded.total_engines",[hash,total]);
      await pg.exec("update qa_installer_security_holds set next_check_at=now()-interval '1 second',checked_at=null");
      await pg.query('select refresh_qa_installer_security_holds()');
      expect((await pg.query<{held:boolean}>('select released_at is null held from qa_installer_security_holds')).rows[0].held).toBe(true);
    }
    await pg.exec("update qa_installer_security_holds set verdict_at=now()-interval '1 hour',first_held_at=now()-interval '2 hours',next_check_at=now()-interval '1 second',checked_at=null");
    await pg.query("update catalog_file_reputation set total_engines=60,analyzed_at=now(),checked_at=now()");
    await pg.query('select refresh_qa_installer_security_holds()');
    expect((await pg.query<{released:boolean}>('select released_at is not null released from qa_installer_security_holds')).rows[0].released).toBe(true);
    expect((await pg.query<{status:string;attempts:number}>('select status,attempts from qa_candidates where id=$1',[id])).rows[0]).toEqual({status:'queued',attempts:2});
    await pg.query("update catalog_file_reputation set malicious=2,analyzed_at=now(),checked_at=now()");
    const before=(await pg.query('select * from qa_installer_security_holds')).rows[0];
    // Model a report already in flight before the independently recorded flag.
    await pg.query("update qa_candidates set status='running' where id=$1",[id]);
    await pg.query("select report_qa_candidate_result('local-fixture-only',$1,'error',$2)",[id,summary]);
    expect((await pg.query('select * from qa_installer_security_holds')).rows[0]).toEqual(before);
    expect((await pg.query<{reason:string}>('select failure_summary reason from qa_candidates where id=$1',[id])).rows[0].reason).toBe('VirusTotal refused execution for this installer hash.');
  } finally {await pg.close();}
},30000);

it('loads zero-verdict holds as waiting rather than refusing or releasing them', async () => {
  const client={from:()=>({select:()=>({in:()=>({is:async()=>({data:[{sha256:hash,next_check_at:'2026-10-17T00:00:00Z',malicious_verdicts:0}],error:null})})})})} as unknown as SupabaseClient<Database>;
  expect(installerSecurityReason(0)).toBe(summary);
  expect((await loadInstallerSecurityHolds(client,[hash])).get(hash)?.reason).toBe(summary);
  expect(installerSecurityReason(1)).toBe('VirusTotal: 1 engine flagged, rechecking daily');
  expect(installerSecurityReason(2)).toBe('VirusTotal refused execution for this installer hash.');
});

it('reserves one global rolling budget for real requests, retaining ambiguous spends and Retry-After', async () => {
  const {pg}=await fixture();
  try {
    const reserve=()=>pg.query<{r:{reservationId:string|null;retryAt:string|null}}>("select reserve_qa_vt_request($1,'hash_lookup') r",[hash]);
    const requests=[];
    for(let i=0;i<4;i++) requests.push((await reserve()).rows[0].r);
    expect(requests.every(r=>r.reservationId)).toBe(true);
    expect(new Set(requests.map(r=>r.reservationId)).size).toBe(4);
    const denied=(await reserve()).rows[0].r;
    expect(denied.reservationId).toBeNull();expect(Date.parse(denied.retryAt!)).toBeGreaterThan(Date.now());
    expect((await pg.query<{n:number}>('select count(*)::int n from qa_vt_requests')).rows[0].n).toBe(4);
    await pg.query('select defer_qa_vt_requests($1,120)',[requests[0].reservationId]);
    await pg.exec("update qa_vt_requests set reserved_at=now()-interval '2 minutes'");
    expect((await reserve()).rows[0].r.reservationId).toBeNull();
    await pg.exec("update qa_vt_request_budget set blocked_until=null");
    expect((await reserve()).rows[0].r.reservationId).toBeTruthy();
    // Existing spends expire only with the rolling day, never after errors.
    await pg.exec("delete from qa_vt_requests; insert into qa_vt_requests(sha256,operation,reserved_at) select repeat('a',64),'hash_lookup',now()-interval '2 minutes' from generate_series(1,450)");
    expect((await reserve()).rows[0].r.reservationId).toBeNull();
    await pg.exec("update qa_vt_requests set reserved_at=now()-interval '25 hours'");
    expect((await reserve()).rows[0].r.reservationId).toBeTruthy();
    await expect(pg.query("select reserve_qa_vt_request($1,'arbitrary_url')",[hash])).rejects.toThrow();
    await expect(pg.query("select reserve_qa_vt_request($1,'upload')",['0'.repeat(64)])).rejects.toThrow();
    await expect(pg.query("select defer_qa_vt_requests('22222222-2222-4222-8222-222222222222',120)")).rejects.toThrow();
    await pg.exec('set role anon');
    try {await expect(reserve()).rejects.toThrow('permission denied');}finally{await pg.exec('reset role');}
    await pg.exec('set role service_role');
    try {expect((await reserve()).rows[0].r.reservationId).toBeTruthy();}finally{await pg.exec('reset role');}
  } finally {await pg.close();}
},30000);
