import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

const held = 'a'.repeat(64), clean = 'b'.repeat(64);

it('holds a curated release only for its own installer, never for a held upgrade baseline', async () => {
  const { pg, read } = await historicalFixture();
  try {
    await pg.exec(read('../../supabase/migrations/20261012153307_qa_installer_security_holds.sql'));
    await pg.exec(read('../../supabase/migrations/20261103104500_curated_hold_candidate_only.sql'));
    await pg.query('insert into public.qa_installer_security_holds(sha256,malicious_verdicts) values($1,2)', [held]);
    const isHeld = async (inputs: object) =>
      (await pg.query<{ r: boolean }>('select public.qa_curated_installer_security_held($1) r', [inputs])).rows[0].r;
    expect(await isHeld({ candidate: JSON.stringify({ vendorSha256: held }) })).toBe(true);
    expect(await isHeld({ candidate: JSON.stringify({ vendorSha256: clean }), previous: JSON.stringify({ vendorSha256: held }) })).toBe(false);
    expect(await isHeld({ candidate: 'invalid json' })).toBe(true);
    expect(await isHeld({ candidate: JSON.stringify({ vendorSha256: clean }), previous: 'invalid json' })).toBe(false);

    const newer = '44444444-4444-4444-8444-444444444444';
    await pg.query("insert into public.curated_verification_queue(id,status,priority,enqueued_at,inputs) values($1,'queued',2000,now(),$2)",
      [newer, { candidate: JSON.stringify({ vendorSha256: clean }), previous: JSON.stringify({ vendorSha256: held }) }]);
    expect((await pg.query<{ r: { id: string } }>('select public.next_qa_curated_security_eligible() r')).rows[0].r.id).toBe(newer);
    await pg.query("update public.curated_verification_queue set status='dispatched' where id=$1", [newer]);
    await pg.query("insert into public.curated_verification_queue(id,status,priority,enqueued_at,inputs) values(gen_random_uuid(),'queued',2000,now(),$1)",
      [{ candidate: JSON.stringify({ vendorSha256: held }) }]);
    await expect(pg.query("update public.curated_verification_queue set status='dispatched' where status='queued'")).rejects.toThrow('Installer security hold');
  } finally { await pg.close(); }
}, 30000);
