import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

it('projects the unchanged claim cadence, private demand joins and service-only access without mutating holds', async () => {
  const { pg, read } = await historicalFixture();
  const hash = 'a'.repeat(64), other = 'b'.repeat(64), active = '33333333-3333-4333-8333-333333333333';
  const linked = '44444444-4444-4444-8444-444444444444';
  try {
    await pg.exec(read('../../supabase/migrations/20261012153307_qa_installer_security_holds.sql'));
    await pg.exec('create table qa_vt_requests(sha256 text,operation text,reserved_at timestamptz);');
    await pg.exec(read('../../supabase/migrations/20261022132553_qa_installer_recheck_customer_cadence.sql'));
    const runtimeDefinitions = async () => (await pg.query(`select proname,md5(pg_get_functiondef(oid)) definition
      from pg_proc where proname in ('claim_qa_installer_security_rechecks','refresh_qa_installer_security_holds',
      'complete_qa_installer_security_recheck','guard_qa_installer_security','report_qa_candidate_result') order by proname`)).rows;
    const before = await runtimeDefinitions();
    if (!process.env.QA_SCHEDULE_BASELINE) await pg.exec(read('../../supabase/migrations/20261024202824_qa_installer_security_recheck_schedule.sql'));
    await pg.exec('grant select on qa_installer_security_holds,qa_vt_requests,packaging_jobs,qa_candidates to service_role;');
    await pg.query(`insert into qa_candidates(id,status,test_level,installer_sha256,priority) values
      ($1,'running','psadt-package',$2,0),($3,'error','psadt-package',$4,1)`, [active, other, linked, hash.toUpperCase()]);
    await pg.query(`insert into qa_installer_security_holds(sha256,malicious_verdicts,first_held_at,next_check_at)
      values($1,1,now()-interval '20 days',now()-interval '1 day'),($2,1,now()-interval '3 days',now()-interval '1 day')`, [hash, other]);
    await pg.query("insert into qa_vt_requests values($1,'hash_lookup',now()-interval '2 days')", [hash]);
    const schedule = async () => (await pg.query<{sha256:string;demand:boolean;eligible_at:string}>(
      'select * from qa_installer_security_recheck_schedule($1)', [[hash, other]])).rows;
    const holdState = async () => (await pg.query('select * from qa_installer_security_holds order by sha256')).rows;
    const held = await holdState();
    let rows = await schedule();
    expect(rows.every(row => !row.demand)).toBe(true);
    expect((await pg.query(`select eligible_at = (select max(reserved_at)+interval '7 days' from qa_vt_requests where sha256=$2) exact from qa_installer_security_recheck_schedule($1) where sha256=$2`, [[hash], hash])).rows[0]).toEqual({exact:true});
    // With no ledger entry the first hold, not a cache expiry, anchors the week.
    expect((await pg.query(`select eligible_at = h.first_held_at+interval '7 days' exact from qa_installer_security_recheck_schedule($1) s join qa_installer_security_holds h using(sha256)`, [[other]])).rows[0]).toEqual({exact:true});
    expect(await holdState()).toEqual(held);
    await pg.query("insert into packaging_jobs(id,status,installer_sha256) values(gen_random_uuid(),'awaiting_qa',$1)", [hash.toUpperCase()]);
    rows = await schedule(); expect(rows.find(row => row.sha256 === hash)?.demand).toBe(true);
    expect((await pg.query('select eligible_at = h.next_check_at exact from qa_installer_security_recheck_schedule($1) s join qa_installer_security_holds h using(sha256) where s.sha256=$2', [[hash], hash])).rows[0]).toEqual({exact:true});
    await pg.exec("update packaging_jobs set archived_at=now();");
    expect((await schedule()).find(row => row.sha256 === hash)?.demand).toBe(false);
    await pg.query("insert into packaging_jobs(id,status,qa_candidate_id) values(gen_random_uuid(),'awaiting_qa',$1)", [linked]);
    expect((await schedule()).find(row => row.sha256 === hash)?.demand).toBe(true);
    await pg.exec("update packaging_jobs set status='completed';");
    expect((await schedule()).find(row => row.sha256 === hash)?.demand).toBe(false);
    // Parity with the actual claim inside a rollback: same eligible set, no new grant.
    await pg.query("update qa_vt_requests set reserved_at=now()-interval '8 days' where sha256=$1", [hash]);
    await pg.exec('begin');
    const eligible = (await pg.query<{sha256:string}>('select sha256 from qa_installer_security_recheck_schedule($1) where eligible_at<=now()', [[hash, other]])).rows.map(row => row.sha256);
    const claimed = (await pg.query<{r:Array<{sha256:string}>}>('select claim_qa_installer_security_rechecks($1,$2,5) r', ['local-fixture-only', active])).rows[0].r.map(row => row.sha256);
    expect(claimed).toEqual(eligible); await pg.exec('rollback');
    for (const role of ['anon','authenticated']) {
      await pg.exec(`set role ${role}`);
      await expect(schedule()).rejects.toThrow(/permission denied/);
      await pg.exec('reset role');
    }
    await pg.exec('set role service_role'); expect(await schedule()).toHaveLength(2); await pg.exec('reset role');
    expect(await runtimeDefinitions()).toEqual(before);
  } finally { await pg.close(); }
}, 30000);
