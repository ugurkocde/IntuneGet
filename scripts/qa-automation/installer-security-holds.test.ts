import fs from 'node:fs';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { expect, it } from 'vitest';

async function historicalFixture() {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  await pg.exec('create schema extensions; create extension pgcrypto with schema extensions; create role anon; create role authenticated; create role service_role bypassrls;');
  for (const table of JSON.parse(read('./fixtures/diagnostic-retest-schema.json'))) {
    const columns = table.columns.map((column: { name: string; data_type: string; format: string }) => `"${column.name}" ${column.data_type === 'ARRAY' ? column.format.slice(1) + '[]' : column.data_type === 'USER-DEFINED' ? 'text' : column.data_type}${column.name === 'id' && column.data_type === 'uuid' ? ' default gen_random_uuid()' : ''}`);
    if (table.columns.some((column: { name: string }) => column.name === 'id')) columns.push('primary key(id)');
    if (table.name === 'public.qa_repair_requests') columns.push('unique(candidate_id)');
    await pg.exec(`create table ${table.name} (${columns.join(',')});`);
  }
  await pg.exec('create table public.catalog_file_reputation(sha256 text primary key,status text,malicious integer,suspicious integer,total_engines integer,analyzed_at timestamptz,checked_at timestamptz); grant usage on schema public,extensions to service_role; grant all on all tables in schema public to service_role;');
  const baseline = JSON.parse(read('./fixtures/diagnostic-retest-functions.json'));
  await pg.exec(baseline.claimant);
  await pg.exec(baseline.reporter);
  await pg.exec(read('../../supabase/migrations/20261011075101_qa_guarded_diagnostic_retests.sql').replace(/\r\n/g, '\n'));
  return { pg, read };
}

it.each(['scanning_installer', 'publishing'])('adopts an uncached, run-bound historical refusal in phase %s', async (phase) => {
  const { pg, read } = await historicalFixture();
  try {
    const id = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222', hash = 'A'.repeat(64), pin = 'b'.repeat(40);
    const canonical = JSON.stringify({ toolchain: { packagerCommit: pin } });
    const profile = crypto.createHash('sha256').update(canonical).digest('hex').toUpperCase();
    await pg.query(`insert into qa_pipeline_control(id,paused,required_packager_commit,scheduler_packager_commit,scheduler_seen_at) values('global',false,$1,$1,now())`, [pin]);
    for (const candidateId of [id, second]) await pg.query(`insert into qa_candidates(id,winget_id,version,architecture,installer_sha256,test_level,package_profile_sha256,test_config,status,attempts,priority,enqueued_at,next_retry_at) values($1,$2,'1','x64',$3,'psadt-package',$4,$5,'queued',0,10,now(),now())`, [candidateId, candidateId === id ? 'Example.App' : 'Other.App', hash, profile, { packageProfileCanonicalJson: canonical, profileKind: 'catalog-default' }]);
    await pg.query(`update qa_candidates set status='error',phase=$2,github_run_id='123',attempts=2,dispatched_at=now()-interval '2 minutes',started_at=now()-interval '2 minutes',finished_at=now(),failure_summary='QA result publication did not complete; inspect the protected workflow run.' where id=$1`, [id, phase]);
    const observed = (await pg.query<{ at: string }>("select (now()-interval '1 minute')::text at")).rows[0].at;
    await pg.exec(read('../../supabase/migrations/20261012153307_qa_installer_security_holds.sql'));
    const adopt = (args: unknown[]) => pg.query('select record_qa_installer_security_refusal($1,$2,$3,$4,$5)', args);
    const valid = [id, '123', hash, 2, observed];
    if (!process.env.QA_HISTORY_REFUSAL_BASELINE) {
      for (const args of [
        [id, '124', hash, 2, observed], [id, null, hash, 2, observed],
        [id, '123', 'B'.repeat(64), 2, observed], [id, '123', '0'.repeat(64), 2, observed],
        [id, '123', 'invalid', 2, observed], [id, '123', null, 2, observed],
        [id, '123', hash, 0, observed], [id, '123', hash, null, observed], [id, '123', hash, -1, observed],
        [id, '123', hash, 2, null], [id, '123', hash, 2, '2099-01-01T00:00:00Z'],
        [id, '123', hash, 2, '2000-01-01T00:00:00Z'],
        ['33333333-3333-4333-8333-333333333333', '123', hash, 2, observed],
      ]) await expect(adopt(args)).rejects.toThrow();
      for (const status of ['running', 'queued', 'passed']) {
        await pg.query('update qa_candidates set status=$2 where id=$1', [id, status]);
        await expect(adopt(valid)).rejects.toThrow();
      }
      await pg.query("update qa_candidates set status='error' where id=$1", [id]);
      const signature = 'public.record_qa_installer_security_refusal(uuid,text,text,integer,timestamptz)';
      for (const role of ['anon', 'authenticated']) expect((await pg.query<{ allowed: boolean }>('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, signature])).rows[0].allowed).toBe(false);
      await pg.exec('set role anon');
      try { await expect(adopt(valid)).rejects.toThrow('permission denied'); } finally { await pg.exec('reset role'); }
      expect((await pg.query<{ n: number }>('select count(*)::int n from qa_installer_security_holds')).rows[0].n).toBe(0);
      await pg.query("insert into catalog_file_reputation values(lower($1),'error',null,null,null,null,now())", [hash]);
      expect((await pg.query<{ n: number }>('select count(*)::int n from qa_installer_security_holds')).rows[0].n).toBe(0);
      await pg.exec('set role service_role');
      try { await adopt(valid); await adopt(valid); } finally { await pg.exec('reset role'); }
    }
    // On the old migration this returns a dispatched row, reproducing replay.
    for (let attempt = 0; attempt < 2; attempt++) expect((await pg.query<{ r: { row?: unknown } }>("select claim_qa_work('ordinary',$1,$2) r", [second, pin])).rows[0].r.row).toBeUndefined();
    await expect(pg.query("update qa_candidates set status='dispatched' where id=$1", [second])).rejects.toThrow('Installer security hold');
    expect((await pg.query<{ n: number }>('select count(*)::int n from qa_installer_security_holds')).rows[0].n).toBe(1);
    const row = (await pg.query<{ status: string; attempts: number; failure_summary: string }>('select status,attempts,failure_summary from qa_candidates where id=$1', [id])).rows[0];
    expect(row).toEqual({ status: 'error', attempts: 2, failure_summary: 'VirusTotal refused execution for this installer hash.' });
    expect((await pg.query<{ r: Array<{ candidate: { id: string }; nextCheckAt: string }> }>('select qa_installer_security_waiting_errors() r')).rows[0].r[0]).toMatchObject({ candidate: { id } });
    await pg.query("update catalog_file_reputation set status='found',malicious=0,suspicious=0,total_engines=56,analyzed_at=$2::timestamptz-interval '1 minute',checked_at=now() where sha256=lower($1)", [hash, observed]);
    await pg.exec("update qa_installer_security_holds set next_check_at=now()-interval '1 second'");
    expect((await pg.query<{ n: number }>('select refresh_qa_installer_security_holds() n')).rows[0].n).toBe(1);
    expect((await pg.query<{ held: boolean }>('select released_at is null held from qa_installer_security_holds')).rows[0].held).toBe(true);
    await pg.query("update catalog_file_reputation set analyzed_at=now()+interval '1 minute',checked_at=now()+interval '1 minute' where sha256=lower($1)", [hash]);
    expect((await pg.query<{ n: number }>('select refresh_qa_installer_security_holds() n')).rows[0].n).toBe(0);
    await pg.exec("update qa_installer_security_holds set next_check_at=now()-interval '1 second'");
    expect((await pg.query<{ n: number }>('select refresh_qa_installer_security_holds() n')).rows[0].n).toBe(1);
    expect((await pg.query<{ status: string; attempts: number }>('select status,attempts from qa_candidates where id=$1', [id])).rows[0]).toEqual({ status: 'queued', attempts: 2 });
    await pg.query("update qa_candidates set status='error' where id=$1", [id]);
    await expect(adopt(valid)).rejects.toThrow('superseded');
    expect((await pg.query<{ held: boolean }>('select released_at is null held from qa_installer_security_holds')).rows[0].held).toBe(false);
  } finally { await pg.close(); }
}, 30000);

it.each([null, 'scanning_installer'])('prevents exact hash replay even when cosmetic phase is %s', async (phase) => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  try {
    await pg.exec('create schema extensions; create extension pgcrypto with schema extensions; create role anon; create role authenticated; create role service_role bypassrls;');
    for (const table of JSON.parse(read('./fixtures/diagnostic-retest-schema.json'))) {
      const columns = table.columns.map((column: { name: string; data_type: string; format: string }) => `"${column.name}" ${column.data_type === 'ARRAY' ? column.format.slice(1) + '[]' : column.data_type === 'USER-DEFINED' ? 'text' : column.data_type}${column.name === 'id' && column.data_type === 'uuid' ? ' default gen_random_uuid()' : ''}`);
      if (table.columns.some((column: { name: string }) => column.name === 'id')) columns.push('primary key(id)');
      if (table.name === 'public.qa_repair_requests') columns.push('unique(candidate_id)');
      await pg.exec(`create table ${table.name} (${columns.join(',')});`);
    }
    await pg.exec('create table public.catalog_file_reputation(sha256 text primary key,status text,malicious integer,suspicious integer,total_engines integer,analyzed_at timestamptz,checked_at timestamptz); grant usage on schema public,extensions to service_role; grant all on all tables in schema public to service_role;');
    const baseline = JSON.parse(read('./fixtures/diagnostic-retest-functions.json'));
    await pg.exec(baseline.claimant);
    const secret = 'local-fixture-only', digest = crypto.createHash('sha256').update(secret).digest('hex');
    await pg.exec(baseline.reporter.replace(/expected_secret_hash constant text := '[a-f0-9]{64}'/, `expected_secret_hash constant text := '${digest}'`));
    await pg.exec(read('../../supabase/migrations/20261011075101_qa_guarded_diagnostic_retests.sql').replace(/\r\n/g, '\n'));
    const id = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222', hash = 'A'.repeat(64), pin = 'b'.repeat(40);
    const canonical = JSON.stringify({ toolchain: { packagerCommit: pin } });
    const profile = crypto.createHash('sha256').update(canonical).digest('hex').toUpperCase();
    await pg.query(`insert into public.qa_pipeline_control(id,paused,required_packager_commit,scheduler_packager_commit,scheduler_seen_at) values('global',false,$1,$1,now())`, [pin]);
    for (const candidateId of [id, second]) await pg.query(`insert into public.qa_candidates(id,winget_id,version,architecture,installer_sha256,test_level,package_profile_sha256,test_config,status,attempts,priority,enqueued_at,next_retry_at) values($1,$2,'1','x64',$3,'psadt-package',$4,$5,'queued',0,10,now(),now())`, [candidateId, candidateId === id ? 'Example.App' : 'Other.App', hash, profile, { packageProfileCanonicalJson: canonical, profileKind: 'catalog-default' }]);
    if (!process.env.QA_SECURITY_HOLD_BASELINE) await pg.exec(read('../../supabase/migrations/20261012153307_qa_installer_security_holds.sql'));
    await pg.query("update public.qa_candidates set status='running',phase=$2 where id=$1", [id,phase]);
    await pg.query("select public.report_qa_candidate_result($1,$2,'error',$3)", [secret,id,'VirusTotal flagged this exact installer hash (1 malicious verdicts); QA execution refused.']);
    // Same hash, other app/profile and immediate retry must never enter execution.
    for (let attempt = 0; attempt < 2; attempt++) {
      const claimed = await pg.query<{r: {row?: unknown}}>('select public.claim_qa_work(\'ordinary\',$1,$2) as r', [second,pin]);
      expect(claimed.rows[0].r.row).toBeUndefined();
    }
    await expect(pg.query("update public.qa_candidates set status='dispatched' where id=$1", [second])).rejects.toThrow('Installer security hold');
    await pg.query("update public.qa_candidates set status='queued',next_retry_at=now() where id=$1", [id]);
    expect((await pg.query<{held: boolean}>('select next_retry_at>now() as held from public.qa_candidates where id=$1',[id])).rows[0].held).toBe(true);
    // A held curated head must not starve the next clean curated row or the
    // ordinary queue. The selector and claimant use the same hash predicate.
    await pg.query("insert into public.curated_verification_queue(id,status,priority,enqueued_at,inputs) values(gen_random_uuid(),'queued',2000,now()-interval '1 hour',$1)",[{candidate:JSON.stringify({vendorSha256:hash})}]);
    const cleanCurated='33333333-3333-4333-8333-333333333333';
    await pg.query("insert into public.curated_verification_queue(id,status,priority,enqueued_at,inputs) values($1,'queued',2000,now(),$2)",[cleanCurated,{candidate:JSON.stringify({vendorSha256:'B'.repeat(64)})}]);
    expect((await pg.query<{r:{id:string}}>('select public.next_qa_curated_security_eligible() as r')).rows[0].r.id).toBe(cleanCurated);
    expect((await pg.query<{r:{row:{id:string}}}>('select public.claim_qa_work(\'curated\',$1,$2) as r',[cleanCurated,pin])).rows[0].r.row.id).toBe(cleanCurated);
    await pg.exec("update public.curated_verification_queue set status='completed' where status='dispatched'");
    expect((await pg.query<{held:boolean}>("select public.qa_curated_installer_security_held('{\"candidate\":\"invalid json\"}') as held")).rows[0].held).toBe(true);
    expect((await pg.query<{allowed: boolean}>("select has_table_privilege('anon','public.qa_installer_security_holds','SELECT') as allowed")).rows[0].allowed).toBe(false);
    await pg.query('update public.qa_installer_security_holds set next_check_at=now()-interval \'1 second\'');
    expect((await pg.query<{n: number}>('select public.refresh_qa_installer_security_holds() as n')).rows[0].n).toBe(1);
    expect((await pg.query<{n: number}>('select public.refresh_qa_installer_security_holds() as n')).rows[0].n).toBe(0);
    expect((await pg.query<{held: boolean}>('select released_at is null as held from public.qa_installer_security_holds')).rows[0].held).toBe(true);
    await pg.query("insert into public.catalog_file_reputation values(lower($1),'found',0,0,56,now()+interval '1 minute',now()+interval '1 minute')",[hash]);
    await pg.query('update public.qa_installer_security_holds set next_check_at=now()-interval \'1 second\'');
    await pg.query('select public.refresh_qa_installer_security_holds()');
    expect((await pg.query<{released: boolean}>('select released_at is not null as released from public.qa_installer_security_holds')).rows[0].released).toBe(true);
    await pg.exec("update public.curated_verification_queue set status='completed' where status='queued'");
    expect((await pg.query<{r: {row?: {status: string}}}>('select public.claim_qa_work(\'ordinary\',$1,$2) as r',[id,pin])).rows[0].r.row?.status).toBe('dispatched');
  } finally { await pg.close(); }
}, 30000);
