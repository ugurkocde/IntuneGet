import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

const hash = 'a'.repeat(64), id = '11111111-1111-4111-8111-111111111111';
async function fixture() {
  const f = await historicalFixture();
  await f.pg.exec(f.read('../../supabase/migrations/20261012153307_qa_installer_security_holds.sql'));
  await f.pg.exec(f.read('../../supabase/migrations/20261016190552_qa_vt_coverage_holds_and_quota.sql'));
  if (!process.env.QA_VT_UPGRADE_BASELINE) await f.pg.exec(f.read('../../supabase/migrations/20261016201507_qa_vt_positive_hold_upgrade.sql'));
  await f.pg.query("insert into qa_candidates(id,status,test_level,installer_sha256,phase,attempts) values($1,'running','psadt-package',$2,'scanning_installer',2)", [id,hash]);
  await f.pg.query("select report_qa_candidate_result('local-fixture-only',$1,'error','VirusTotal: awaiting engine coverage, rechecking daily')", [id]);
  return f;
}

it.each(['wrong secret','expired lease'])('rejects %s before changing an unknown hold', async denial => {
  const {pg}=await fixture();
  try {
    const active='22222222-2222-4222-8222-222222222222';
    await pg.query("insert into qa_candidates(id,status,test_level,installer_sha256) values($1,'running','psadt-package',$2)",[active,'b'.repeat(64)]);
    await pg.exec("update qa_installer_security_holds set next_check_at=now()-interval '1 second'");
    const lease=(await pg.query<{r:{lease:string}[]}>("select claim_qa_installer_security_rechecks('local-fixture-only',$1,1) r",[active])).rows[0].r[0].lease;
    if (denial==='expired lease') await pg.exec("update qa_installer_security_holds set recheck_lease_expires_at=now()-interval '1 second'");
    const before=(await pg.query('select * from qa_installer_security_holds')).rows[0];
    await expect(pg.query("select complete_qa_installer_security_recheck($1,$2,$3,2,0,60,now()-interval '1 day')",[denial==='wrong secret'?'wrong':'local-fixture-only',hash,lease])).rejects.toThrow(denial==='wrong secret'?'QA authentication rejected':'Daily installer verdict lease rejected');
    expect((await pg.query('select * from qa_installer_security_holds')).rows[0]).toEqual(before);
    expect((await pg.query('select * from catalog_file_reputation')).rows).toHaveLength(0);
  } finally {await pg.close();}
},30000);

it.each([1,2])('upgrades an unknown hold from older covered cache evidence with %i flags without lowering its release floor', async malicious => {
  const {pg} = await fixture();
  try {
    const before = (await pg.query<{verdict_at:Date}>('select verdict_at from qa_installer_security_holds')).rows[0];
    await pg.query("insert into catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,analyzed_at,checked_at) values($1,'found',$2,0,60,now()-interval '1 day',now())", [hash,malicious]);
    expect((await pg.query('select malicious_verdicts,verdict_at,released_at from qa_installer_security_holds')).rows[0]).toEqual({malicious_verdicts:malicious,verdict_at:before.verdict_at,released_at:null});
    await pg.exec("update catalog_file_reputation set malicious=0,analyzed_at=now()-interval '1 hour'; update qa_installer_security_holds set checked_at=null,next_check_at=now()-interval '1 second'");
    await pg.query('select refresh_qa_installer_security_holds()');
    expect((await pg.query<{held:boolean}>('select released_at is null held from qa_installer_security_holds')).rows[0].held).toBe(true);
    // A stale lower flag never downgrades the active positive hold.
    await pg.exec("update catalog_file_reputation set malicious=1,analyzed_at=now()-interval '2 days'");
    expect((await pg.query<{n:number}>('select malicious_verdicts n from qa_installer_security_holds')).rows[0].n).toBe(malicious);
  } finally {await pg.close();}
},30000);

it('does not upgrade unknown from a zero-coverage flagged cache row', async () => {
  const {pg}=await fixture();
  try {
    await pg.query("insert into catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,analyzed_at,checked_at) values($1,'found',2,0,0,now()-interval '1 day',now())",[hash]);
    expect((await pg.query<{n:number}>('select malicious_verdicts n from qa_installer_security_holds')).rows[0].n).toBe(0);
  } finally {await pg.close();}
},30000);

it('claims and completes an unknown hold with older flagged coverage, preserving a newer cache and rejecting stale clean release', async () => {
  const {pg}=await fixture();
  try {
    const active='22222222-2222-4222-8222-222222222222';
    await pg.query("insert into qa_candidates(id,status,test_level,installer_sha256) values($1,'running','psadt-package',$2)",[active,'b'.repeat(64)]);
    await pg.exec("update qa_installer_security_holds set next_check_at=now()-interval '1 second'");
    const lease=(await pg.query<{r:{sha256:string;lease:string}[]}>("select claim_qa_installer_security_rechecks('local-fixture-only',$1,1) r",[active])).rows[0].r[0].lease;
    await pg.query("insert into catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,analyzed_at,checked_at) values($1,'found',0,0,60,now()-interval '1 hour',now())",[hash]);
    expect((await pg.query<{r:boolean}>("select complete_qa_installer_security_recheck('local-fixture-only',$1,$2,2,0,60,now()-interval '1 day') r",[hash,lease])).rows[0].r).toBe(true);
    expect((await pg.query<{n:number}>('select malicious_verdicts n from qa_installer_security_holds')).rows[0].n).toBe(2);
    expect((await pg.query<{n:number}>('select malicious n from catalog_file_reputation')).rows[0].n).toBe(0);
    await pg.exec("update qa_installer_security_holds set next_check_at=now()-interval '1 second',checked_at=null");
    await pg.query('select refresh_qa_installer_security_holds()');
    expect((await pg.query<{held:boolean}>('select released_at is null held from qa_installer_security_holds')).rows[0].held).toBe(true);
    expect((await pg.query<{attempts:number}>('select attempts from qa_candidates where id=$1',[id])).rows[0].attempts).toBe(2);
    await pg.exec("update qa_installer_security_holds set verdict_at=now()-interval '1 minute',next_check_at=now()-interval '1 second',checked_at=null");
    const next=(await pg.query<{r:{lease:string}[]}>("select claim_qa_installer_security_rechecks('local-fixture-only',$1,1) r",[active])).rows[0].r[0].lease;
    expect((await pg.query<{r:boolean}>("select complete_qa_installer_security_recheck('local-fixture-only',$1,$2,0,0,60,now()) r",[hash,next])).rows[0].r).toBe(true);
    expect((await pg.query<{released:boolean}>('select released_at is not null released from qa_installer_security_holds')).rows[0].released).toBe(true);
  } finally {await pg.close();}
},30000);
