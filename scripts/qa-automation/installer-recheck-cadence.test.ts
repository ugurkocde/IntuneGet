import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

const active = '11111111-1111-4111-8111-111111111111';
const held = '22222222-2222-4222-8222-222222222222';
const hash = 'a'.repeat(64);
const migration = new URL('../../supabase/migrations/20261022132553_qa_installer_recheck_customer_cadence.sql', import.meta.url);

async function fixture(demand = false) {
  const pg = new PGlite();
  await pg.exec(`create table qa_candidates(id uuid primary key,installer_sha256 text,test_level text,status text,priority integer,next_retry_at timestamptz);
    create table packaging_jobs(id uuid default gen_random_uuid(),installer_sha256 text,qa_candidate_id uuid,status text,archived_at timestamptz);
    create table qa_vt_requests(sha256 text,operation text,reserved_at timestamptz);
    create table qa_installer_security_holds(sha256 text primary key,malicious_verdicts integer,first_held_at timestamptz,verdict_at timestamptz,next_check_at timestamptz,checked_at timestamptz,released_at timestamptz,recheck_lease uuid,recheck_lease_expires_at timestamptz);
    create function authenticate_qa_installer_recheck(text) returns void language plpgsql as $$begin if $1 <> 'fixture' then raise exception 'auth';end if;end$$;
    insert into qa_candidates values('${active}',repeat('b',64),'psadt-package','running',1,now()),('${held}','${hash}','psadt-package','error',1,now());
    insert into qa_installer_security_holds values('${hash}',1,now()-interval '10 days',now()-interval '10 days',now()-interval '1 day',now()-interval '2 days',null,null,null);
    insert into qa_vt_requests values('${hash}','hash_lookup',now()-interval '2 days');`);
  const base = fs.readFileSync(new URL('../../supabase/migrations/20261012153307_qa_installer_security_holds.sql', import.meta.url), 'utf8');
  const start = base.indexOf('create function public.claim_qa_installer_security_rechecks(');
  const end = base.indexOf('revoke all on function public.claim_qa_installer_security_rechecks', start);
  await pg.exec(base.slice(start, end));
  if (!process.env.QA_RECHECK_CADENCE_BASELINE) await pg.exec(fs.readFileSync(migration, 'utf8'));
  if (demand) await pg.query("insert into packaging_jobs(installer_sha256,qa_candidate_id,status) values($1,$2,'awaiting_qa')", [hash.toUpperCase(), held]);
  return pg;
}

async function claim(pg: PGlite) {
  return (await pg.query<{r: {sha256: string}[]}>('select claim_qa_installer_security_rechecks($1,$2,5) r', ['fixture', active])).rows[0].r;
}

it('does not spend a daily recheck on a no-demand hash', async () => {
  const pg = await fixture();
  try { expect(await claim(pg)).toEqual([]); } finally { await pg.close(); }
}, 30000);

it('bounds the weekly ledger anchor with an exact hash lookup index', async () => {
  const pg = await fixture();
  try {
    await pg.exec("insert into qa_vt_requests select repeat(md5(g::text),2),'hash_lookup',now()-interval '3 days' from generate_series(1,5000) g;analyze qa_vt_requests");
    const plan = await pg.query("explain (format json) select max(r.reserved_at) from qa_vt_requests r where r.sha256='" + hash + "' and r.operation='hash_lookup'");
    expect(JSON.stringify(plan.rows)).toContain('qa_vt_requests_hash_lookup_idx');
  } finally { await pg.close(); }
}, 30000);

it('keeps awaiting customer hashes on daily cadence', async () => {
  const pg = await fixture(true);
  try { expect((await claim(pg)).map(x => x.sha256)).toEqual([hash]); } finally { await pg.close(); }
}, 30000);

it('restores daily eligibility on the next pass when demand appears', async () => {
  const pg = await fixture();
  try {
    expect(await claim(pg)).toEqual([]);
    await pg.query("insert into packaging_jobs(installer_sha256,qa_candidate_id,status) values($1,$2,'awaiting_qa')", [hash, held]);
    expect((await claim(pg)).map(x => x.sha256)).toEqual([hash]);
  } finally { await pg.close(); }
}, 30000);

it('keeps archived or completed customer jobs on weekly cadence', async () => {
  const pg = await fixture();
  try {
    await pg.query("insert into packaging_jobs(installer_sha256,status,archived_at) values($1,'awaiting_qa',now()),($1,'deployed',null)", [hash]);
    expect(await claim(pg)).toEqual([]);
  } finally { await pg.close(); }
}, 30000);

it('never releases a hold or claims an active lease', async () => {
  const pg = await fixture(true);
  try {
    await pg.exec("update qa_installer_security_holds set next_check_at=now()+interval '1 day',recheck_lease=gen_random_uuid(),recheck_lease_expires_at=now()+interval '5 minutes'");
    expect(await claim(pg)).toEqual([]);
    expect((await pg.query('select released_at from qa_installer_security_holds')).rows[0].released_at).toBeNull();
  } finally { await pg.close(); }
}, 30000);

it('does not let cache refreshes postpone a weekly provider check forever', async () => {
  const pg = await fixture();
  try {
    await pg.exec("update qa_vt_requests set reserved_at=now()-interval '8 days';update qa_installer_security_holds set checked_at=now()");
    expect((await claim(pg)).map(x => x.sha256)).toEqual([hash]);
    expect((await pg.query<{daily:boolean}>("select next_check_at between now()+interval '23 hours' and now()+interval '25 hours' daily from qa_installer_security_holds")).rows[0].daily).toBe(true);
  } finally { await pg.close(); }
}, 30000);

it('preserves later backoff even for customer demand', async () => {
  const pg = await fixture(true);
  try {
    await pg.exec("update qa_installer_security_holds set next_check_at=now()+interval '3 days'");
    expect(await claim(pg)).toEqual([]);
  } finally { await pg.close(); }
}, 30000);

it('uses an awaiting candidate binding when the job hash is absent', async () => {
  const pg = await fixture();
  try {
    await pg.query("insert into packaging_jobs(qa_candidate_id,status) values($1,'awaiting_qa')", [held]);
    expect((await claim(pg)).map(x => x.sha256)).toEqual([hash]);
  } finally { await pg.close(); }
}, 30000);

it('keeps new never-checked holds weekly and permits them after seven days', async () => {
  const pg = await fixture();
  try {
    await pg.exec("delete from qa_vt_requests;update qa_installer_security_holds set first_held_at=now()-interval '2 days',checked_at=null");
    expect(await claim(pg)).toEqual([]);
    await pg.exec("update qa_installer_security_holds set first_held_at=now()-interval '8 days'");
    expect((await claim(pg)).map(x => x.sha256)).toEqual([hash]);
  } finally { await pg.close(); }
}, 30000);
