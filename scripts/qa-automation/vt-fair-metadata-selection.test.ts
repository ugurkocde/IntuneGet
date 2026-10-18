import {it} from 'vitest';
import {historicalFixture} from './installer-security-fixture';

it('gives eligible public submissions a turn without starving metadata', async()=>{
  const f=await historicalFixture();
  try {
    for(const name of ['20260714201549_installer_preflight_health','20261012153307_qa_installer_security_holds',
      '20261016190552_qa_vt_coverage_holds_and_quota','20261016201507_qa_vt_positive_hold_upgrade',
      '20261016210756_qa_vt_public_submission_bridge','20261017005156_qa_vt_metadata_rechecks',
      '20261017032327_qa_vt_ledger_acl','20261017142911_qa_vt_submission_dispatch_binding',
      '20261017162556_qa_vt_terminal_lookup_proof','20261017162626_qa_vt_terminal_verdict_completion',
      '20261018044857_qa_vt_terminal_metadata_admission']) {
      await f.pg.exec(f.read('../../supabase/migrations/'+name+'.sql'));
    }
    await f.pg.exec(f.read('../../supabase/migrations/20261018130856_qa_vt_fair_metadata_selection.sql'));
    await f.pg.exec(f.read('../../supabase/tests/qa_vt_terminal_metadata_admission.sql'));
    // The same executable contract is used by the real PostgreSQL CI fixture.
    await f.pg.exec(f.read('../../supabase/tests/qa_vt_fair_metadata_selection.sql'));
  } finally { await f.pg.close(); }
},30000);
