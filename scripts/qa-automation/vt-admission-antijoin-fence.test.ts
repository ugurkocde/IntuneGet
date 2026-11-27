import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

const PREREQ_MIGRATIONS = [
  '20260714201549_installer_preflight_health',
  '20261012153307_qa_installer_security_holds',
  '20261016190552_qa_vt_coverage_holds_and_quota',
  '20261016201507_qa_vt_positive_hold_upgrade',
  '20261016210756_qa_vt_public_submission_bridge',
  '20261017005156_qa_vt_metadata_rechecks',
  '20261017032327_qa_vt_ledger_acl',
  '20261017142911_qa_vt_submission_dispatch_binding',
  '20261017162556_qa_vt_terminal_lookup_proof',
  '20261017162626_qa_vt_terminal_verdict_completion',
  '20261018044857_qa_vt_terminal_metadata_admission',
  '20261018104456_qa_vt_terminal_newer_index',
  '20261018183000_qa_vt_upload_url_recovery',
  '20261112153855_qa_vt_admission_prefilters',
];

it('fences already-admitted candidates before qa_vt_terminal_identity and uses the partial admission index', async () => {
  const f = await historicalFixture();
  try {
    for (const name of PREREQ_MIGRATIONS) {
      await f.pg.exec(f.read(`../../supabase/migrations/${name}.sql`));
    }

    const antijoinSql = f.read('../../supabase/tests/qa_vt_admission_antijoin_fence.sql');
    const prefiltersSql = f.read('../../supabase/tests/qa_vt_admission_prefilters.sql');

    // Failing-before check: prior migration invokes qa_vt_terminal_identity on already-admitted rows.
    await expect(f.pg.exec(antijoinSql)).rejects.toThrow(
      /Already-admitted rows reached opaque identity predicate/,
    );
    await f.pg.exec('rollback;');

    await f.pg.exec(f.read('../../supabase/migrations/20261127171800_qa_vt_admission_antijoin_fence.sql'));

    // Both the new anti-join fence test and the existing prefilter parity test pass.
    await f.pg.exec(antijoinSql);
    await f.pg.exec(prefiltersSql);

    // Verify ACLs and secret authentication remain unchanged.
    const acl = await f.pg.query<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select
        has_function_privilege('anon', 'public.admit_qa_vt_terminal_metadata_rechecks(text)', 'execute') as anon,
        has_function_privilege('authenticated', 'public.admit_qa_vt_terminal_metadata_rechecks(text)', 'execute') as auth,
        has_function_privilege('service_role', 'public.admit_qa_vt_terminal_metadata_rechecks(text)', 'execute') as svc`,
    );
    expect(acl.rows[0]).toEqual({ anon: true, auth: false, svc: true });
    await expect(
      f.pg.query("select public.admit_qa_vt_terminal_metadata_rechecks('wrong-fixture-secret')"),
    ).rejects.toThrow();
  } finally {
    await f.pg.close();
  }
}, 60000);
