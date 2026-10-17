import { describe, expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

const migrations = ['20260714201549_installer_preflight_health',
  '20261012153307_qa_installer_security_holds',
  '20261016190552_qa_vt_coverage_holds_and_quota',
  '20261016201507_qa_vt_positive_hold_upgrade',
  '20261016210756_qa_vt_public_submission_bridge',
  '20261017005156_qa_vt_metadata_rechecks'];
const aclMigration = '20261017032327_qa_vt_ledger_acl';
const hash = 'a'.repeat(64);

async function fixture() {
  const f = await historicalFixture();
  // Match the production creator's defaults, rather than vanilla PostgreSQL.
  await f.pg.exec(`alter default privileges for role postgres in schema public
    grant all on tables to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public
    grant execute on functions to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public
    grant all on sequences to anon,authenticated,service_role;`);
  for (const n of migrations) await f.pg.exec(f.read(`../../supabase/migrations/${n}.sql`));
  await f.pg.exec(f.read(`../../supabase/migrations/${aclMigration}.sql`));
  return f;
}

async function use(fn: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const f = await fixture();
  try { await fn(f); } finally { await f.pg.close(); }
}

describe('VirusTotal ledger ACL', () => {
  it.each([
    ['public.qa_vt_requests', 'SELECT', true],
    ['public.qa_vt_requests', 'INSERT', true],
    ['public.qa_vt_requests', 'UPDATE', false],
    ['public.qa_vt_requests', 'DELETE', false],
    ['public.qa_vt_requests', 'TRUNCATE', false],
    ['public.qa_vt_requests', 'TRIGGER', false],
    ['public.qa_vt_requests', 'REFERENCES', false],
    ['public.qa_vt_requests', 'MAINTAIN', false],
    ['public.qa_vt_request_budget', 'SELECT', true],
    ['public.qa_vt_request_budget', 'UPDATE', true],
    ['public.qa_vt_request_budget', 'INSERT', false],
    ['public.qa_vt_request_budget', 'DELETE', false],
    ['public.qa_vt_request_budget', 'TRUNCATE', false],
    ['public.qa_vt_request_budget', 'TRIGGER', false],
    ['public.qa_vt_request_budget', 'REFERENCES', false],
    ['public.qa_vt_request_budget', 'MAINTAIN', false],
  ])('%s %s has only its intended service privilege (%s)', (table, privilege, allowed) => use(async f => {
    const q = await f.pg.query<{allowed: boolean}>('select has_table_privilege($1,$2,$3) allowed', ['service_role',table,privilege]);
    expect(q.rows[0].allowed).toBe(allowed);
  }), 30000);

  it.each([
    'delete from public.qa_vt_requests',
    'update public.qa_vt_requests set reserved_at=now()-interval \'2 days\'',
    'truncate public.qa_vt_requests',
    'lock table public.qa_vt_requests in access exclusive mode',
    'delete from public.qa_vt_request_budget',
    'insert into public.qa_vt_request_budget(id) values(true)',
  ])('denies quota refund/erase path: %s', command => use(async f => {
    await f.pg.query("select public.reserve_qa_vt_request($1,'hash_lookup')", [hash]);
    await f.pg.exec('set role service_role');
    const needsTransaction = command.startsWith('lock ');
    if (needsTransaction) await f.pg.exec('begin');
    await expect(f.pg.exec(command)).rejects.toThrow(/permission denied/);
    if (needsTransaction) await f.pg.exec('rollback');
    await f.pg.exec('reset role');
    expect((await f.pg.query('select * from public.qa_vt_requests')).rows).toHaveLength(1);
  }), 30000);

  it.each([
    'blocked_until=null',
    "blocked_until=now()",
    "metering_started_at=now()-interval '1 day'",
    'id=false',
  ])('denies service budget reduction or identity rewrite: %s', change => use(async f => {
    await f.pg.exec("update public.qa_vt_request_budget set blocked_until=now()+interval '1 day'");
    const before = (await f.pg.query('select * from public.qa_vt_request_budget')).rows;
    await f.pg.exec('set role service_role');
    await expect(f.pg.exec(`update public.qa_vt_request_budget set ${change}`)).rejects.toThrow(/may only be extended/);
    await f.pg.exec('reset role');
    expect((await f.pg.query('select * from public.qa_vt_request_budget')).rows).toEqual(before);
    expect((await f.pg.query('select * from public.qa_vt_requests')).rows).toHaveLength(0);
  }), 30000);

  it('preserves reserve, both defer functions and owner-only lowering', () => use(async f => {
    await f.pg.exec('set role service_role');
    const r = (await f.pg.query<{r: {reservationId: string}}>("select public.reserve_qa_vt_request($1,'hash_lookup') r", [hash])).rows[0].r;
    expect(r.reservationId).toMatch(/^[a-f0-9-]{36}$/);
    await f.pg.query('select public.defer_qa_vt_requests($1,120)', [r.reservationId]);
    const first = (await f.pg.query<{blocked_until: Date}>('select blocked_until from public.qa_vt_request_budget')).rows[0].blocked_until;
    await f.pg.query("select public.defer_qa_vt_requests_until($1,clock_timestamp()+interval '10 minutes')", [r.reservationId]);
    const second = (await f.pg.query<{blocked_until: Date}>('select blocked_until from public.qa_vt_request_budget')).rows[0].blocked_until;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    await f.pg.exec('reset role; update public.qa_vt_request_budget set blocked_until=null,metering_started_at=clock_timestamp()');
    expect((await f.pg.query<{blocked_until: Date|null}>('select blocked_until from public.qa_vt_request_budget')).rows[0].blocked_until).toBeNull();
  }), 30000);

  it('retains the initial hold and spends no reservation', () => use(async f => {
    const deadline = new Date(Date.now()+86400000).toISOString();
    await f.pg.query('update public.qa_vt_request_budget set blocked_until=$1', [deadline]);
    await f.pg.exec('set role service_role');
    const r = (await f.pg.query<{r: {reservationId: null;retryAt: string}}>("select public.reserve_qa_vt_request($1,'hash_lookup') r", [hash])).rows[0].r;
    expect(r.reservationId).toBeNull();
    expect(new Date(r.retryAt).toISOString()).toBe(deadline);
    expect((await f.pg.query('select * from public.qa_vt_requests')).rows).toHaveLength(0);
  }), 30000);

  it('lets the secret-bound definer metadata claim bind its own reservation', () => use(async f => {
    const candidate = '12345678-1234-1234-1234-123456789abc';
    await f.pg.query("insert into public.qa_candidates(id,winget_id,version,architecture,installer_sha256,package_profile_sha256,github_run_id,status,phase,test_level,finished_at) values($1,'Fixture.App','1','x64',$2,$3,'1234','error','publishing','psadt-package',now()-interval '5 minutes')", [candidate,hash.toUpperCase(),'B'.repeat(64)]);
    await f.pg.query("insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at,first_queued_at,last_http_status) values($1,$2,$3,'1234',now()-interval '1 minute',now()-interval '5 minutes',429)", [candidate,hash,'B'.repeat(64)]);
    await f.pg.exec('set role anon');
    const q = (await f.pg.query<{q:{candidateId:string;reservationId:string}}>("select public.claim_qa_vt_metadata_recheck('local-fixture-only') q")).rows[0].q;
    expect(q.candidateId).toBe(candidate);
    expect(q.reservationId).toMatch(/^[a-f0-9-]{36}$/);
    await f.pg.exec('reset role');
    expect((await f.pg.query<{metadata_candidate_id:string}>('select metadata_candidate_id from public.qa_vt_requests')).rows[0].metadata_candidate_id).toBe(candidate);
    expect((await f.pg.query('select * from public.qa_installer_security_holds')).rows).toHaveLength(0);
  }), 30000);
});
