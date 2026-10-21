import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({ client: vi.fn(), trigger: vi.fn(), complete: vi.fn(), approval: vi.fn(), gate: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ createServerClient: mocks.client }));
vi.mock('@/lib/github-actions', () => ({ triggerPackagingWorkflow: mocks.trigger }));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({}) }));
vi.mock('@/lib/intune-approval-guard', () => ({ findPendingApprovalBlocks: mocks.approval }));
vi.mock('@/lib/auto-update/cleanup', () => ({ handleAutoUpdateJobCompletion: mocks.complete }));
vi.mock('@/lib/features', () => ({ getFeatureFlags: () => ({ localPackager: false }) }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => ({ app: { url: 'https://example.test' } }) }));
vi.mock('@/lib/customer-upstream-recovery', () => ({ holdCustomerUpstreamJob: vi.fn(async () => false), reopenCustomerUpstreamJobs: vi.fn(async () => 0) }));
vi.mock('@/lib/qa/customer-failure-recovery', () => ({ reopenSupersededQaFailures: vi.fn(async () => 0) }));
vi.mock('@/lib/qa/demand', () => ({ ensureQaDemand: vi.fn() }));
vi.mock('@/lib/catalog-installer-reconciliation', () => ({ reconcileCatalogInstaller: vi.fn(async item => ({ item, trustedInstallers: [] })) }));
vi.mock('@/lib/curated-catalog/licence', async original => ({ ...(await original<object>()), assertCuratedLicenceAccepted: vi.fn(async () => null) }));
vi.mock('@/lib/package-eligibility', async original => ({ ...(await original<object>()), getPackageCompatibilityBlock: vi.fn(async () => null) }));
vi.mock('@/lib/qa/gate', async original => ({ ...(await original<object>()), enforceQaGate: mocks.gate }));

import { GET } from './route';
import { InstallerPreflightError } from '@/lib/installer-preflight';

const jobId = '00000000-0000-4000-8000-000000000576';
const candidateId = '00000000-0000-4000-8000-000000000577';
let pg: PGlite;

function migration(name: string) {
  return readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
}
function statement(source: string, pattern: RegExp) {
  const match = source.match(pattern);
  if (!match) throw new Error('Required migration statement was not found');
  return match[0];
}

// The shim translates only this route's query subset. PostgREST transport and
// multi-connection locking are outside this local PostgreSQL contract test.
function jobsQuery() {
  const columns = new Set(['id', 'status', 'status_message', 'qa_candidate_id', 'installer_sha256', 'architecture', 'qa_completed_at', 'packaging_started_at', 'qa_resume_due_at', 'github_run_id', 'github_run_url', 'error_code', 'error_stage', 'error_category', 'error_message', 'completed_at']);
  const ident = (column: string) => {
    if (column === 'package_config->>installerSha256') return "package_config->>'installerSha256'";
    if (column === 'package_config->>architecture') return "package_config->>'architecture'";
    if (!columns.has(column)) throw new Error(`Unsupported test column: ${column}`);
    return `"${column}"`;
  };
  const filters: Array<{ column: string; operator: string; value: unknown }> = [];
  const orders: string[] = [];
  let patch: Record<string, unknown> | undefined;
  let projection = '*';
  let maxRows: number | undefined;
  const run = async (single: boolean) => {
    const values: unknown[] = [];
    const parameter = (value: unknown) => { values.push(value); return `$${values.length}`; };
    let sql = patch ? `update packaging_jobs set ${Object.entries(patch).map(([key, value]) => `${ident(key)} = ${parameter(value)}`).join(', ')}` : `select ${projection} from packaging_jobs`;
    if (filters.length) sql += ' where ' + filters.map(({ column, operator, value }) => operator === 'is' ? `${ident(column)} is null` : operator === 'in' ? `${ident(column)} in (${(value as unknown[]).map(parameter).join(',')})` : `${ident(column)} ${operator} ${parameter(value)}`).join(' and ');
    if (patch) sql += ` returning ${projection}`;
    else {
      if (orders.length) sql += ` order by ${orders.join(', ')}`;
      if (maxRows !== undefined) sql += ` limit ${parameter(maxRows)}`;
    }
    try {
      const result = await pg.query(sql, values);
      if (single && result.rows.length > 1) return { data: null, error: new Error('Multiple rows') };
      return { data: single ? result.rows[0] ?? null : result.rows, error: null };
    } catch (error) { return { data: null, error }; }
  };
  const builder = {
    select(value: string) { projection = value === '*' ? '*' : value.split(',').map(x => ident(x.trim())).join(','); return builder; },
    update(value: Record<string, unknown>) { patch = value; return builder; },
    eq(column: string, value: unknown) { filters.push({ column, operator: '=', value }); return builder; },
    is(column: string, value: null) { if (value !== null) throw new Error('Only IS NULL is supported'); filters.push({ column, operator: 'is', value }); return builder; },
    in(column: string, value: unknown[]) { if (!value.length) throw new Error('Empty IN is unsupported'); filters.push({ column, operator: 'in', value }); return builder; },
    lte(column: string, value: unknown) { filters.push({ column, operator: '<=', value }); return builder; },
    order(column: string, options: { ascending: boolean }) { orders.push(`${ident(column)} ${options.ascending ? 'asc' : 'desc'}`); return builder; },
    limit(value: number) { maxRows = value; return builder; },
    maybeSingle() { return run(true); },
    then(resolve: (result: unknown) => unknown, reject: (reason: unknown) => unknown) { return run(false).then(resolve, reject); },
  };
  return builder;
}

function fixtureQuery(data: object) {
  const builder = {
    select: () => builder, eq: () => builder, in: () => builder, order: () => builder, limit: () => builder,
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve: (value: object) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  };
  return builder;
}
async function stored() { return (await pg.query<Record<string, unknown>>('select * from packaging_jobs where id=$1', [jobId])).rows[0]; }
async function run() { return GET(new Request('https://example.test/api/cron/qa-resume', { headers: { authorization: 'Bearer synthetic-test-only' } })); }

describe('qa-resume PostgreSQL dispatch catch', () => {
  beforeAll(async () => {
    pg = new PGlite({ parsers: { 1184: value => value } });
    const base = migration('001_packaging_jobs.sql');
    // The candidate table is only an FK target; QA gate results are fixtures.
    await pg.exec('create table qa_candidates(id uuid primary key); set timezone=\'UTC\';');
    await pg.exec(statement(base, /CREATE TABLE IF NOT EXISTS packaging_jobs \([\s\S]*?\n\);/));
    await pg.exec(statement(base, /CREATE OR REPLACE FUNCTION update_updated_at_column\(\)[\s\S]*?EXECUTE FUNCTION update_updated_at_column\(\);/));
    const github = migration('002_add_tenant_and_github.sql');
    for (const name of ['tenant_id', 'github_run_id', 'github_run_url']) await pg.exec(statement(github, new RegExp(`ALTER TABLE packaging_jobs ADD COLUMN IF NOT EXISTS ${name} TEXT;`)));
    await pg.exec(statement(migration('015_enhanced_error_handling.sql'), /ALTER TABLE packaging_jobs[\s\S]*?;/));
    await pg.exec(statement(migration('20260809182115_demand_driven_qa_waiting_jobs.sql'), /alter table public\.packaging_jobs[\s\S]*?;/));
    await pg.exec(statement(migration('20261010190933_qa_resume_due_schedule.sql'), /alter table public\.packaging_jobs[\s\S]*?;/));
  }, 30_000);
  afterAll(async () => { await pg?.close(); });
  beforeEach(async () => {
    vi.useRealTimers(); vi.clearAllMocks();
    delete process.env.QA_MAINTENANCE_MODE; delete process.env.QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL;
    process.env.CRON_SECRET = 'synthetic-test-only';
    mocks.approval.mockResolvedValue([]); mocks.gate.mockResolvedValue(undefined);
    mocks.trigger.mockReset();
    await pg.exec('truncate packaging_jobs, qa_candidates;');
    await pg.query('insert into qa_candidates(id) values($1)', [candidateId]);
    await pg.query(`insert into packaging_jobs(id,user_id,tenant_id,winget_id,version,display_name,status,installer_type,installer_url,installer_sha256,architecture,qa_candidate_id,execution_profile_sha256,package_config,qa_resume_due_at,updated_at) values($1,'synthetic-user','synthetic-tenant','Example.App','1.0','Example App','awaiting_qa','exe','https://example.test/installer.exe',$2,'x64',$3,$4,$5::jsonb,'2026-01-01','2026-01-01')`, [jobId, 'A'.repeat(64), candidateId, 'B'.repeat(64), JSON.stringify({ installerSha256: 'A'.repeat(64), architecture: 'x64' })]);
    mocks.client.mockReturnValue({ from: (table: string) => {
      if (table === 'packaging_jobs') return jobsQuery();
      if (table === 'qa_candidates') return fixtureQuery({ id: candidateId, status: 'passed', package_profile_sha256: 'B'.repeat(64) });
      if (table === 'qa_package_results') return fixtureQuery({ outcome: 'Passed' });
      throw new Error(`Unexpected test table: ${table}`);
    } });
  });

  it.each([null, '2026-10-01T00:00:00Z'])('holds a retryable failure then resumes after the due time: %s', async prior => {
    await pg.query('update packaging_jobs set qa_completed_at=$1, updated_at=\'2026-01-01\' where id=$2', [prior, jobId]);
    const before = await stored();
    mocks.trigger.mockRejectedValueOnce(new InstallerPreflightError('PREFLIGHT_UNAVAILABLE', 'socket hang up', true)).mockResolvedValueOnce({ runId: 4242, runUrl: 'https://example.test/run/4242' });
    const start = Date.now();
    expect(await (await run()).json()).toMatchObject({ held: 1, failed: 0, resumed: 0 });
    const held = await stored();
    expect(held).toMatchObject({ status: 'awaiting_qa', packaging_started_at: null, github_run_id: null, completed_at: null, error_code: null, error_message: null, qa_completed_at: before.qa_completed_at });
    expect(Date.parse(held.qa_resume_due_at as string)).toBeGreaterThanOrEqual(start + 60_000);
    expect(Date.parse(held.qa_resume_due_at as string)).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(Date.parse(held.updated_at as string)).toBeGreaterThanOrEqual(Date.parse(before.updated_at as string));
    expect(await (await run()).json()).toMatchObject({ scanned: 0 });
    expect(mocks.trigger).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 61_000);
    try {
      expect(await (await run()).json()).toMatchObject({ resumed: 1, failed: 0 });
      expect(await stored()).toMatchObject({ status: 'packaging', github_run_id: '4242' });
      expect((await stored()).packaging_started_at).not.toBeNull();
      expect(mocks.trigger).toHaveBeenCalledTimes(2);
      expect(mocks.approval).toHaveBeenCalledTimes(2);
      expect(mocks.gate).toHaveBeenCalledTimes(2);
      expect(mocks.complete).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it.each(['run', 'status', 'config'])('preserves a concurrent %s change', async kind => {
    let concurrent: Record<string, unknown>;
    mocks.trigger.mockImplementationOnce(async () => {
      if (kind === 'run') await pg.query('update packaging_jobs set github_run_id=$1 where id=$2', ['123', jobId]);
      if (kind === 'status') await pg.query('update packaging_jobs set status=$1 where id=$2', ['cancelled', jobId]);
      if (kind === 'config') await pg.query("update packaging_jobs set package_config=jsonb_set(package_config,'{installerSha256}',$1::jsonb) where id=$2", [JSON.stringify('C'.repeat(64)), jobId]);
      concurrent = await stored();
      throw new InstallerPreflightError('PREFLIGHT_UNAVAILABLE', 'socket hang up', true);
    });
    expect(await (await run()).json()).toMatchObject({ held: 0, failed: 0, resumed: 0 });
    expect(await stored()).toEqual(concurrent!);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous dispatch error terminal', async () => {
    mocks.trigger.mockRejectedValueOnce(new Error('socket hang up'));
    expect(await (await run()).json()).toMatchObject({ held: 0, failed: 1 });
    expect(await stored()).toMatchObject({ status: 'failed', error_code: 'QA_RESUME_DISPATCH_FAILED' });
    expect((await stored()).completed_at).not.toBeNull();
    expect(mocks.complete).toHaveBeenCalledOnce();
  });
});
