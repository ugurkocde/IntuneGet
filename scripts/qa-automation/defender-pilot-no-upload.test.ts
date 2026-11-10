import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

const pin = 'cd14fa085865af02c1b5f3b0ac1401352f2297ff26a6204d3e92d3f74b236602';
const signature = 'public.reserve_qa_vt_candidate_request(text,uuid,text,text,uuid)';

it('refuses pilot uploads before spending quota while preserving authenticated lookups and unrelated uploads', async () => {
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
    ]) await f.pg.exec(f.read('../../supabase/migrations/' + name + '.sql').replaceAll('\r\n', '\n'));
    const contract = f.read('../../supabase/tests/qa_defender_pilot_no_upload.sql');
    await expect(f.pg.exec(contract)).rejects.toThrow('Pilot upload was not refused');
    await f.pg.exec('rollback');
    const shipped = f.read('../../supabase/migrations/20261110134102_qa_defender_pilot_no_upload.sql');
    expect(shipped.split(pin)).toHaveLength(2);
    const original = await f.pg.query<{ source: string; digest: string }>(`select pg_get_functiondef('${signature}'::regprocedure) as source,
      encode(extensions.digest(pg_get_functiondef('${signature}'::regprocedure),'sha256'),'hex') as digest`);
    // Only the disposable fixture pin is substituted; the shipped production pin remains immutable.
    const fixtureMigration = shipped.replace(pin, original.rows[0].digest);
    await expect(f.pg.exec(shipped.replace(pin, '0'.repeat(64)))).rejects.toThrow('source pin mismatch');
    const anchor = "  elsif p_operation='hash_lookup' then";
    for (const count of [0, 2]) {
      await f.pg.exec('begin');
      const source = count === 0 ? original.rows[0].source.replace(anchor, '  elsif (p_operation)=\'hash_lookup\' then')
        : original.rows[0].source.replace(anchor, '-- ' + anchor + '\n' + anchor);
      await f.pg.exec(source);
      const hash = await f.pg.query<{ digest: string }>(`select encode(extensions.digest(pg_get_functiondef('${signature}'::regprocedure),'sha256'),'hex') as digest`);
      await expect(f.pg.exec(shipped.replace(pin, hash.rows[0].digest))).rejects.toThrow('anchor mismatch');
      await f.pg.exec('rollback');
    }
    await f.pg.exec(fixtureMigration);
    await f.pg.exec(contract);
    await f.pg.exec(f.read('../../supabase/tests/qa_vt_upload_url_recovery.sql'));
    await expect(f.pg.exec(fixtureMigration)).rejects.toThrow('source pin mismatch');
  } finally { await f.pg.close(); }
}, 30000);
