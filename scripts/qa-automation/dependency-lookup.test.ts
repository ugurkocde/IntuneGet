import {expect,it} from 'vitest';
import {historicalFixture} from './installer-security-fixture';

it('admits only installed own-run dependency hashes and preserves cache, quota, leases and holds',async()=>{
  const f=await historicalFixture();
  try {
    for(const n of ['20260714201549_installer_preflight_health','20261012153307_qa_installer_security_holds',
      '20261016190552_qa_vt_coverage_holds_and_quota','20261016201507_qa_vt_positive_hold_upgrade',
      '20261016210756_qa_vt_public_submission_bridge','20261017005156_qa_vt_metadata_rechecks',
      '20261017032327_qa_vt_ledger_acl','20261017142911_qa_vt_submission_dispatch_binding',
      '20261017162556_qa_vt_terminal_lookup_proof','20261017162626_qa_vt_terminal_verdict_completion',
      '20261018044857_qa_vt_terminal_metadata_admission','20261019105229_qa_dependency_execution_receipts']) {
      await f.pg.exec(f.read('../../supabase/migrations/'+n+'.sql'));
    }
    await expect(f.pg.query("select admit_qa_vt_dependency_rechecks('local-fixture-only')")).rejects.toThrow(/does not exist/);
    const prior=(await f.pg.query<{definition:string}>("select pg_get_functiondef('reserve_qa_vt_candidate_request(text,uuid,text,text,uuid)'::regprocedure) definition")).rows[0].definition;
    if(!process.env.QA_DEPENDENCY_LOOKUP_BASELINE) await f.pg.exec(f.read('../../supabase/migrations/20261019125457_qa_vt_dependency_lookup.sql'));
    await expect(f.pg.query("select admit_qa_vt_dependency_rechecks('wrong')")).rejects.toThrow(/authentication/);
    for(const role of ['anon','authenticated','service_role']) {
      expect((await f.pg.query<{allowed:boolean}>("select has_table_privilege($1,'qa_vt_dependency_rechecks','INSERT') allowed",[role])).rows[0].allowed).toBe(false);
    }
    expect((await f.pg.query<{allowed:boolean}>("select has_function_privilege('authenticated','admit_qa_vt_dependency_rechecks(text)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
    await f.pg.exec(f.read('../../supabase/tests/qa_vt_dependency_lookup.sql'));
    const bound=f.read('../../supabase/tests/qa_vt_dependency_admission_bound.sql');
    await expect(f.pg.exec(bound)).rejects.toThrow(/ADMISSION_UNBOUNDED/);
    await f.pg.exec('rollback');
    await f.pg.exec(f.read('../../supabase/migrations/20261019141403_qa_vt_dependency_admission_bound.sql'));
    await f.pg.exec(bound);
    await f.pg.exec(f.read('../../supabase/tests/qa_vt_dependency_lookup.sql'));
    expect((await f.pg.query<{definition:string}>("select pg_get_functiondef('reserve_qa_vt_candidate_request(text,uuid,text,text,uuid)'::regprocedure) definition")).rows[0].definition).toBe(prior);
  }finally{await f.pg.close();}
},30000);
