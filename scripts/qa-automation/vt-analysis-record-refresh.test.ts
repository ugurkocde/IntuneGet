import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

it('selects only exact completed analysis evidence without changing metadata claims', async () => {
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
      '20261019024840_qa_vt_post_upload_priority', '20261018011340_qa_vt_result_record_refresh',
    ]) await f.pg.exec(f.read('../../supabase/migrations/' + name + '.sql'));
    const query = `select pg_get_functiondef('public.claim_qa_vt_metadata_recheck(text)'::regprocedure) as definition`;
    const before = await f.pg.query(query);
    const test = f.read('../../supabase/tests/qa_vt_analysis_record_refresh.sql');
    await expect(f.pg.exec(test)).rejects.toThrow('Completed analysis publication proof missing');
    await f.pg.exec('rollback');
    await f.pg.exec(f.read('../../supabase/migrations/20261019045306_qa_vt_analysis_record_refresh.sql'));
    await f.pg.exec(test);
    expect((await f.pg.query(query)).rows).toEqual(before.rows);
    const privileges = await f.pg.query(`select
      has_function_privilege('anon','public.list_qa_vt_resolved_record_refreshes(text,integer)','EXECUTE') as anon,
      has_function_privilege('service_role','public.list_qa_vt_resolved_record_refreshes(text,integer)','EXECUTE') as service,
      has_function_privilege('authenticated','public.list_qa_vt_resolved_record_refreshes(text,integer)','EXECUTE') as authenticated`);
    expect(privileges.rows).toEqual([{ anon: true, service: true, authenticated: false }]);
  } finally { await f.pg.close(); }
}, 30000);
