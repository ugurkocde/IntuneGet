import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

it('records only bounded own-run receipts without publication, quota or security side effects', async () => {
  const f = await historicalFixture();
  try {
    for (const n of ['20260714201549_installer_preflight_health', '20261012153307_qa_installer_security_holds', '20261016190552_qa_vt_coverage_holds_and_quota']) {
      await f.pg.exec(f.read('../../supabase/migrations/' + n + '.sql'));
    }
    const call = "select record_qa_dependency_receipt('wrong',gen_random_uuid(),'123',1,repeat('C',64),'{}','Passed')";
    await expect(f.pg.query(call)).rejects.toThrow(/does not exist/);
    await f.pg.exec(f.read('../../supabase/migrations/20261019105229_qa_dependency_execution_receipts.sql'));
    await expect(f.pg.query(call)).rejects.toThrow(/authentication/);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect((await f.pg.query<{ allowed: boolean }>("select has_table_privilege($1,'qa_dependency_execution_receipts','INSERT') allowed", [role])).rows[0].allowed).toBe(false);
    }
    expect((await f.pg.query<{ allowed: boolean }>("select has_function_privilege('authenticated','record_qa_dependency_receipt(text,uuid,text,integer,text,jsonb,text)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
    await f.pg.exec(f.read('../../supabase/tests/qa_dependency_execution_receipts.sql'));
  } finally { await f.pg.close(); }
}, 30000);
