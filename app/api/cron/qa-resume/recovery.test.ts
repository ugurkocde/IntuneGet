import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ client: vi.fn(), consent: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ createServerClient: mocks.client }));
vi.mock('@/lib/msp/consent-verification', () => ({ verifyTenantConsent: mocks.consent }));
vi.mock('@/lib/features', () => ({ getFeatureFlags: () => ({ localPackager: true }) }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => ({ app: { url: 'https://example.test' } }) }));
vi.mock('@/lib/github-actions', () => ({ triggerPackagingWorkflow: vi.fn() }));
vi.mock('@/lib/auto-update/cleanup', () => ({ handleAutoUpdateJobCompletion: vi.fn() }));
vi.mock('@/lib/qa/demand', () => ({ ensureQaDemand: vi.fn() }));
vi.mock('@/lib/catalog-installer-reconciliation', () => ({ reconcileCatalogInstaller: vi.fn() }));
vi.mock('@/lib/package-eligibility', () => ({ getPackageCompatibilityBlock: vi.fn(), PACKAGE_VERSION_UNAVAILABLE_MESSAGE: 'Unavailable' }));
vi.mock('@/lib/curated-catalog/licence', () => ({ assertCuratedLicenceAccepted: vi.fn(), CuratedLicenceError: class extends Error {} }));

import { GET } from './route';

function fixture() {
  const profile = 'A'.repeat(64), hash = 'B'.repeat(64);
  const job = {
    id: 'job', tenant_id: 'tenant-fake', winget_id: 'Example.App', version: '1.0',
    architecture: 'x64', installer_sha256: hash, execution_profile_sha256: profile,
    qa_candidate_id: 'candidate', status: 'qa_failed', error_code: 'QA_FAILED_EXECUTION_PROFILE',
    archived_at: null, cancelled_at: null, intune_app_id: null, is_auto_update: false,
    completed_at: '2026-10-01T10:00:00Z', qa_completed_at: '2026-10-01T10:00:00Z',
    created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T10:00:00Z', package_config: { description: 'Keep presentation', installerSha256: hash },
    presentation_profile_sha256: 'C'.repeat(64), error_stage: 'validation', error_category: 'installer',
  };
  const candidate = { id: 'candidate', status: 'passed', winget_id: 'Example.App', version: '1.0', architecture: 'x64', installer_sha256: hash, package_profile_sha256: profile, finished_at: '2026-10-01T11:00:00Z' };
  const result = { package_profile_sha256: profile, outcome: 'Passed', winget_id: 'Example.App', tested_version: '1.0', architecture: 'x64', installer_sha256: hash };
  return { job, candidate, result };
}

function database(f: ReturnType<typeof fixture>, options: { history?: boolean; duplicate?: boolean; race?: (job: typeof f.job) => void; lookupError?: boolean; newerFailures?: number } = {}) {
  const rows = [...Array.from({ length: options.newerFailures || 0 }, (_, n) => ({ ...f.job, id: 'newer-' + n, winget_id: 'Other.App' + n, qa_candidate_id: 'failed-' + n, created_at: '2026-10-02T09:00:00Z' })), f.job, ...(options.duplicate ? [{ ...f.job, id: 'other', status: 'packaging' }] : [])];
  const writes: Record<string, unknown>[] = [];
  let raced = false;
  return { writes, client: { from(table: string) {
    const predicates: ((row: Record<string, unknown>) => boolean)[] = [];
    let patch: Record<string, unknown> | undefined;
    let count = Infinity;
    const b = {
      select: () => b, order: () => b,
      limit: (n: number) => { count = n; return b; },
      eq: (k: string, v: unknown) => {
        if (v !== null && typeof v === 'object') throw new Error('PostgREST scalar filter required');
        predicates.push(row => (k === 'qa_candidates.status'
          ? row.qa_candidate_id === f.candidate.id ? f.candidate.status : 'failed' : row[k]) === v);
        return b;
      },
      neq: (k: string, v: unknown) => { predicates.push(row => row[k] !== v); return b; },
      is: (k: string, v: unknown) => { predicates.push(row => row[k] === v); return b; },
      in: (k: string, v: unknown[]) => { predicates.push(row => v.includes(row[k])); return b; },
      update: (v: Record<string, unknown>) => { patch = v; return b; },
      maybeSingle: async () => { const r = await execute(); return { ...r, data: r.data?.[0] ?? null }; },
      then: (resolve: (value: unknown) => unknown) => execute().then(resolve),
    };
    async function execute() {
      if (options.lookupError && table === 'qa_package_results') return { data: null, error: { message: 'synthetic timeout' } };
      if (patch && !raced) { options.race?.(f.job); raced = true; }
      const source = table === 'packaging_jobs' ? rows : table === 'qa_candidates' ? [f.candidate]
        : table === 'qa_package_results' ? [f.result] : table === 'upload_history' ? (options.history ? [{ intune_tenant_id: f.job.tenant_id, winget_id: f.job.winget_id, version: f.job.version }] : []) : [];
      const data = source.filter(row => predicates.every(test => test(row))).slice(0, count);
      if (patch) for (const row of data) { writes.push(patch); Object.assign(row, patch); }
      return { data: structuredClone(data), error: null };
    }
    return b;
  } } };
}

describe('QA failure recovery in the existing resume cron', () => {
  beforeEach(() => { process.env.CRON_SECRET = 'fixture-secret'; vi.clearAllMocks(); mocks.consent.mockResolvedValue({ verified: true }); });
  async function run(f: ReturnType<typeof fixture>, options: Parameters<typeof database>[1] = {}) {
    const db = database(f, options); mocks.client.mockReturnValue(db.client);
    const response = await GET(new Request('https://example.test/api/cron/qa-resume', { headers: { authorization: 'Bearer fixture-secret' } }));
    return { db, response: await response.json() };
  }

  it('reopens a failure superseded by an exact later pass without dispatching a second QA lifecycle', async () => {
    const f = fixture(), config = structuredClone(f.job.package_config);
    const { db, response } = await run(f);
    expect(response.reopened).toBe(1);
    expect(f.job.status).toBe('awaiting_qa');
    expect(f.job.error_code).toBeNull();
    expect(f.job.completed_at).toBeNull();
    expect(f.job.package_config).toEqual(config);
    expect(f.job.presentation_profile_sha256).toBe('C'.repeat(64));
    expect(db.writes).toHaveLength(1);
  });

  it.each(['archive', 'cancel', 'other cause', 'auto update', 'already uploaded', 'late failure', 'wrong profile', 'wrong hash', 'wrong result', 'no tenant', 'failed candidate'])('preserves %s', async reason => {
    const f = fixture();
    if (reason === 'archive') Object.assign(f.job, { archived_at: '2026-10-01T12:00:00Z' });
    if (reason === 'cancel') Object.assign(f.job, { cancelled_at: '2026-10-01T12:00:00Z' });
    if (reason === 'other cause') f.job.error_code = 'INTUNE_APPROVAL_REQUIRED';
    if (reason === 'auto update') f.job.is_auto_update = true;
    if (reason === 'already uploaded') Object.assign(f.job, { intune_app_id: 'app-fake' });
    if (reason === 'late failure') f.job.completed_at = '2026-10-01T12:00:00Z';
    if (reason === 'wrong profile') f.candidate.package_profile_sha256 = 'D'.repeat(64);
    if (reason === 'wrong hash') f.candidate.installer_sha256 = 'D'.repeat(64);
    if (reason === 'wrong result') f.result.tested_version = '2.0';
    if (reason === 'no tenant') f.job.tenant_id = '';
    if (reason === 'failed candidate') f.candidate.status = 'failed';
    const { db } = await run(f);
    expect(db.writes).toHaveLength(0); expect(f.job.status).toBe('qa_failed');
  });

  it.each(['history', 'duplicate', 'lookupError', 'no consent', 'dismissal race', 'identity race', 'configuration race'])('fails closed on %s', async reason => {
    const f = fixture();
    if (reason === 'no consent') mocks.consent.mockResolvedValue({ verified: false });
    const { db } = await run(f, {
      history: reason === 'history', duplicate: reason === 'duplicate', lookupError: reason === 'lookupError',
      race: reason === 'dismissal race' ? job => { Object.assign(job, { archived_at: '2026-10-01T12:00:00Z' }); }
        : reason === 'identity race' ? job => { job.execution_profile_sha256 = 'D'.repeat(64); }
        : reason === 'configuration race' ? job => { job.package_config.description = 'Edited'; job.updated_at = '2026-10-01T12:00:00Z'; } : undefined,
    });
    expect(db.writes).toHaveLength(0); expect(f.job.status).toBe('qa_failed');
  });

  it('finds the older passed candidate beyond ten newer genuine failures', async () => {
    const f = fixture();
    const { response } = await run(f, { newerFailures: 12 });
    expect(response.reopened).toBe(1);
    expect(f.job.status).toBe('awaiting_qa');
  });

  it('uses the server update time to date a legacy failure without completion times', async () => {
    const f = fixture();
    Object.assign(f.job, { completed_at: null, qa_completed_at: null });
    const { response } = await run(f);
    expect(response.reopened).toBe(1);
  });

  it('keeps an undated failure whose last server update follows the pass', async () => {
    const f = fixture();
    Object.assign(f.job, { completed_at: null, qa_completed_at: null, updated_at: '2026-10-01T12:00:00Z' });
    const { db } = await run(f);
    expect(db.writes).toHaveLength(0);
  });
});

