import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

it('excludes unsupported public work before consuming attempts or blocking hash work', async () => {
  const f = await historicalFixture();
  try {
    for (const name of [
      '20260714201549_installer_preflight_health', '20261012153307_qa_installer_security_holds',
      '20261016190552_qa_vt_coverage_holds_and_quota', '20261016201507_qa_vt_positive_hold_upgrade',
      '20261016210756_qa_vt_public_submission_bridge', '20261017005156_qa_vt_metadata_rechecks',
      '20261017032327_qa_vt_ledger_acl', '20261017142911_qa_vt_submission_dispatch_binding',
      '20261017162556_qa_vt_terminal_lookup_proof', '20261017162626_qa_vt_terminal_verdict_completion',
      '20261018044857_qa_vt_terminal_metadata_admission', '20261018130856_qa_vt_fair_metadata_selection',
      '20261018140859_qa_vt_metadata_drain', '20261018163200_qa_vt_preflight_priority',
      '20261018183000_qa_vt_upload_url_recovery', '20261018230638_qa_vt_post_analysis_hash_recheck',
      '20261019024840_qa_vt_post_upload_priority',
    ]) await f.pg.exec(f.read('../../supabase/migrations/' + name + '.sql'));
    const original = await f.pg.query(`select prosrc,proacl::text from pg_proc
      where oid='public.claim_qa_vt_metadata_recheck(text)'::regprocedure`);
    const contract = f.read('../../supabase/tests/qa_vt_metadata_public_capability.sql');
    await expect(f.pg.exec(contract)).rejects.toThrow('does not exist');
    await f.pg.exec('rollback');
    await f.pg.exec(f.read('../../supabase/migrations/20261024002955_qa_vt_metadata_public_capability.sql'));
    expect((await f.pg.query(`select prosrc,proacl::text from pg_proc
      where oid='public.claim_qa_vt_metadata_recheck(text)'::regprocedure`)).rows).toEqual(original.rows);
    await f.pg.exec(contract);
    const hosted = f.read('../../supabase/tests/qa_vt_fair_metadata_selection.sql')
      .replace('truncate public.qa_vt_requests,', 'truncate public.qa_vt_upload_url_recovery_grants,public.qa_vt_requests,')
      .replaceAll("claim_qa_vt_metadata_recheck('local-fixture-only')", "claim_qa_vt_metadata_recheck('local-fixture-only',true)");
    await f.pg.exec(hosted);
    const postAnalysis = f.read('../../supabase/tests/qa_vt_post_upload_priority.sql')
      .replaceAll("claim_qa_vt_metadata_recheck('local-fixture-only')", "claim_qa_vt_metadata_recheck('local-fixture-only',false)");
    for (const mode of ['no_customer','customer_ready','customer_fresh','backoff']) {
      await f.pg.exec("set qa.priority_case='" + mode + "';");
      await f.pg.exec(postAnalysis);
    }
    for (const role of ['anon','authenticated','service_role']) {
      const result = await f.pg.query(`select
        has_function_privilege('${role}','public.claim_qa_vt_metadata_recheck(text)','EXECUTE') =
        has_function_privilege('${role}','public.claim_qa_vt_metadata_recheck(text,boolean)','EXECUTE') as equal`);
      expect(result.rows).toEqual([{ equal: true }]);
    }
    await expect(f.pg.exec(`select public.claim_qa_vt_metadata_recheck('wrong-fixture',false)`)).rejects.toThrow();
    await expect(f.pg.exec(`select public.claim_qa_vt_metadata_recheck('local-fixture-only',null)`)).rejects.toThrow('QA VT capability required');
    const source = await f.pg.query<{prosrc:string}>(`select prosrc from pg_proc
      where oid='public.claim_qa_vt_metadata_recheck(text,boolean)'::regprocedure`);
    const stripped = source.rows[0].prosrc
      .replace("  if p_public_capable is null then raise exception 'QA VT capability required';end if;\n", '')
      .replace("when not p_public_capable then array['metadata'] ", '')
      .replaceAll('p_public_capable and ', '');
    expect(stripped.replaceAll('\r\n','\n').trim()).toBe((original.rows[0] as {prosrc:string}).prosrc.replaceAll('\r\n','\n').trim());
  } finally { await f.pg.close(); }
}, 30000);
