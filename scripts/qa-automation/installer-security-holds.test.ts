import fs from 'node:fs';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { expect, it } from 'vitest';

it('prevents exact hash replay through claims and direct recovery, including within one minute', async () => {
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
    await pg.query("update public.qa_candidates set status='running',phase='scanning_installer' where id=$1", [id]);
    await pg.query("select public.report_qa_candidate_result($1,$2,'error',$3)", [secret,id,'VirusTotal flagged this exact installer hash (1 malicious verdicts); QA execution refused.']);
    // Same hash, other app/profile and immediate retry must never enter execution.
    for (let attempt = 0; attempt < 2; attempt++) {
      const claimed = await pg.query<{r: {row?: unknown}}>('select public.claim_qa_work(\'ordinary\',$1,$2) as r', [second,pin]);
      expect(claimed.rows[0].r.row).toBeUndefined();
    }
    await expect(pg.query("update public.qa_candidates set status='dispatched' where id=$1", [second])).rejects.toThrow('Installer security hold');
    await pg.query("update public.qa_candidates set status='queued',next_retry_at=now() where id=$1", [id]);
    expect((await pg.query<{held: boolean}>('select next_retry_at>now() as held from public.qa_candidates where id=$1',[id])).rows[0].held).toBe(true);
    expect((await pg.query<{allowed: boolean}>("select has_table_privilege('anon','public.qa_installer_security_holds','SELECT') as allowed")).rows[0].allowed).toBe(false);
    await pg.query('update public.qa_installer_security_holds set next_check_at=now()-interval \'1 second\'');
    expect((await pg.query<{n: number}>('select public.refresh_qa_installer_security_holds() as n')).rows[0].n).toBe(1);
    expect((await pg.query<{n: number}>('select public.refresh_qa_installer_security_holds() as n')).rows[0].n).toBe(0);
    expect((await pg.query<{held: boolean}>('select released_at is null as held from public.qa_installer_security_holds')).rows[0].held).toBe(true);
    await pg.query("insert into public.catalog_file_reputation values(lower($1),'found',0,0,56,now()+interval '1 minute',now()+interval '1 minute')",[hash]);
    await pg.query('update public.qa_installer_security_holds set next_check_at=now()-interval \'1 second\'');
    await pg.query('select public.refresh_qa_installer_security_holds()');
    expect((await pg.query<{released: boolean}>('select released_at is not null as released from public.qa_installer_security_holds')).rows[0].released).toBe(true);
    expect((await pg.query<{r: {row?: {status: string}}}>('select public.claim_qa_work(\'ordinary\',$1,$2) as r',[id,pin])).rows[0].r.row?.status).toBe('dispatched');
  } finally { await pg.close(); }
}, 30000);
