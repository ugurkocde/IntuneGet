import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createServerClientMock,
  getFeatureFlagsMock,
  handleAutoUpdateJobCompletionMock,
  ensureQaDemandMock,
  reconcileCatalogInstallerMock,
  triggerPackagingWorkflowMock,
  assertCuratedLicenceAcceptedMock,
  getPackageCompatibilityBlockMock,
} = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  getFeatureFlagsMock: vi.fn(),
  handleAutoUpdateJobCompletionMock: vi.fn(),
  ensureQaDemandMock: vi.fn(),
  reconcileCatalogInstallerMock: vi.fn(),
  triggerPackagingWorkflowMock: vi.fn(),
  assertCuratedLicenceAcceptedMock: vi.fn(),
  getPackageCompatibilityBlockMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ createServerClient: createServerClientMock }));
vi.mock('@/lib/features', () => ({ getFeatureFlags: getFeatureFlagsMock }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => ({ app: { url: 'https://example.test' } }) }));
vi.mock('@/lib/github-actions', () => ({ triggerPackagingWorkflow: triggerPackagingWorkflowMock }));
vi.mock('@/lib/auto-update/cleanup', () => ({
  handleAutoUpdateJobCompletion: handleAutoUpdateJobCompletionMock,
}));
vi.mock('@/lib/curated-catalog/licence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/curated-catalog/licence')>()),
  assertCuratedLicenceAccepted: assertCuratedLicenceAcceptedMock,
}));
vi.mock('@/lib/qa/demand', () => ({ ensureQaDemand: ensureQaDemandMock }));
vi.mock('@/lib/package-eligibility', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/package-eligibility')>()),
  getPackageCompatibilityBlock: getPackageCompatibilityBlockMock,
}));
vi.mock('@/lib/catalog-installer-reconciliation', () => ({
  reconcileCatalogInstaller: reconcileCatalogInstallerMock,
}));

import { GET } from './route';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
import { CuratedLicenceError } from '@/lib/curated-catalog/licence';
import { QA_PRIORITY_CUSTOMER } from '@/lib/qa/constants';
import { PACKAGE_VERSION_UNAVAILABLE_MESSAGE } from '@/lib/package-eligibility';

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'not', 'order', 'limit', 'update']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

// Respect PostgREST projection and equality filters instead of returning fields
// the route did not request. A missing candidate behaves like maybeSingle().
function candidateQuery(rows: Record<string, unknown>[]) {
  const builder = chain({ data: null, error: null });
  let columns: string[] = [];
  const filters: Array<[string, unknown]> = [];
  builder.select = vi.fn((projection: string) => {
    columns = projection.split(',').map((column) => column.trim());
    return builder;
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    filters.push([column, value]);
    return builder;
  });
  builder.maybeSingle = vi.fn(async () => {
    const matches = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
    if (matches.length > 1) return { data: null, error: { code: 'PGRST116' } };
    if (!matches.length) return { data: null, error: null };
    const row = matches[0];
    return {
      data: columns.includes('*') ? structuredClone(row)
        : Object.fromEntries(columns.map((column) => [column, row[column]])),
      error: null,
    };
  });
  return builder;
}

// Model conditional writes against a live row, not a predetermined response.
// Each request's read snapshot is independent of later concurrent writes.
function jobStore(initial: Record<string, unknown>) {
  const row = structuredClone(initial);
  const writes: ReturnType<typeof chain>[] = [];
  function updateQuery() {
    const filters: Array<[string, unknown]> = [];
    let patch: Record<string, unknown> = {};
    const builder = chain({ data: null, error: null });
    builder.update = vi.fn((value) => { patch = value; return builder; });
    builder.eq = vi.fn((column, value) => { filters.push([column, value]); return builder; });
    builder.is = vi.fn((column, value) => { filters.push([column, value]); return builder; });
    builder.maybeSingle = vi.fn(async () => {
      const matches = filters.every(([column, value]) => {
        const [field, key] = column.split('->>');
        const actual = key ? (row[field] as Record<string, unknown> | null)?.[key] : row[field];
        return (actual ?? null) === value;
      });
      if (!matches) return { data: null, error: null };
      Object.assign(row, structuredClone(patch));
      return { data: structuredClone(row), error: null };
    });
    builder.then = (resolve: (value: unknown) => unknown) => (builder.maybeSingle as () => Promise<unknown>)().then(resolve);
    writes.push(builder);
    return builder;
  }
  return { row, writes, updateQuery };
}

describe('GET /api/cron/qa-resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.QA_MAINTENANCE_MODE;
    delete process.env.QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL;
    process.env.CRON_SECRET = 'secret';
    getFeatureFlagsMock.mockReturnValue({ localPackager: true });
    assertCuratedLicenceAcceptedMock.mockResolvedValue(null);
    getPackageCompatibilityBlockMock.mockResolvedValue(null);
    reconcileCatalogInstallerMock.mockImplementation(async (item) => ({
      item,
      trustedInstallers: [],
    }));
  });

  it.each([1, 2, 3].flatMap((jobCount) => [true, false].flatMap((localPackager) =>
    [true, false].flatMap((isAutoUpdate) => [true, false].map((continuity) =>
      ({ jobCount, localPackager, isAutoUpdate, continuity }))))))(
    'keeps pending publication waiting: %j',
    async ({ jobCount, localPackager, isAutoUpdate, continuity }) => {
    getFeatureFlagsMock.mockReturnValue({ localPackager });
    if (continuity) process.env.QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL = new Date(Date.now() + 60_000).toISOString();
    const jobs = Array.from({ length: jobCount }, (_, index) => ({
      id: `publication-job-${index}`,
      status: 'awaiting_qa',
      is_auto_update: isAutoUpdate,
      qa_candidate_id: 'candidate-publication-pending',
      execution_profile_sha256: 'A'.repeat(64),
      installer_sha256: 'B'.repeat(64),
      architecture: 'x64',
      created_at: '2026-10-09T08:00:00Z',
      package_config: { sourceType: 'winget', installerSha256: 'B'.repeat(64), architecture: 'x64' },
    }));
    const updates = chain({ data: { id: 'publication-job' }, error: null });
    let reads = 0;
    createServerClientMock.mockReturnValue({ from: vi.fn((table: string) => {
      if (table === 'packaging_jobs') {
        return ++reads === 1 ? chain({ data: jobs, error: null }) : updates;
      }
      if (table === 'qa_candidates') return candidateQuery([
        { id: 'unrelated-candidate', status: 'failed', phase: 'installing', github_run_id: null },
        {
          id: 'candidate-publication-pending', status: 'error', phase: 'publishing',
          github_run_id: '123456789',
          failure_summary: 'The workflow finished but required result publication did not complete.',
          package_profile_sha256: 'A'.repeat(64),
        },
      ]);
      throw new Error(`Unexpected table ${table}`);
    }) });

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    expect.soft(await response.json()).toEqual({ success: true, scanned: jobCount, resumed: 0, failed: 0, waiting: jobCount });
    expect.soft(updates.update).not.toHaveBeenCalled();
    expect.soft(handleAutoUpdateJobCompletionMock).not.toHaveBeenCalled();
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
    expect(assertCuratedLicenceAcceptedMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'error', phase: 'publishing', run: null, quarantined: false },
    { status: 'error', phase: 'installing', run: '123456789', quarantined: false },
    { status: 'error', phase: 'verifying', run: '123456789', quarantined: false },
    { status: 'error', phase: null, run: '123456789', quarantined: false },
    { status: 'failed', phase: 'publishing', run: '123456789', quarantined: false },
    { status: 'error', phase: 'publishing', run: '123456789', quarantined: true },
  ])('preserves actual failure and quarantine handling: %j', async ({ status, phase, run, quarantined }) => {
    const job = {
      id: 'failure-job', status: 'awaiting_qa', qa_candidate_id: 'failure-candidate',
      installer_sha256: 'B'.repeat(64), architecture: 'x64',
      package_config: { installerSha256: 'B'.repeat(64), architecture: 'x64' },
    };
    const updates = chain({ data: { id: job.id }, error: null });
    let reads = 0;
    createServerClientMock.mockReturnValue({ from: vi.fn((table: string) => {
      if (table === 'packaging_jobs') return ++reads === 1 ? chain({ data: [job], error: null }) : updates;
      if (table === 'qa_candidates') return chain({ data: {
        id: 'failure-candidate', status, phase, github_run_id: run,
        failure_summary: 'Required verification failed', package_profile_sha256: 'A'.repeat(64),
      }, error: null });
      throw new Error(`Unexpected table ${table}`);
    }) });
    if (quarantined) getPackageCompatibilityBlockMock.mockResolvedValue({ code: 'failed_managed_lifecycle' });
    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    expect(await response.json()).toMatchObject({ resumed: 0, failed: 1, waiting: 0 });
    expect(updates.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'qa_failed', error_code: quarantined ? 'QA_PACKAGE_COMPATIBILITY_BLOCKED' : 'QA_FAILED_EXECUTION_PROFILE',
    }));
    expect(handleAutoUpdateJobCompletionMock).toHaveBeenCalledTimes(1);
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it.each([true, false].flatMap((localPackager) => [
    'installer_sha256', 'architecture', 'qa_candidate_id',
    'package_config->>installerSha256', 'package_config->>architecture', 'unchanged',
  ].map((field) => [localPackager, field] as const)))('only fails the observed payload with localPackager=%s and concurrent change=%s', async (localPackager, field) => {
    getFeatureFlagsMock.mockReturnValue({ localPackager });
    const store = jobStore({
      id: 'concurrent-job', status: 'awaiting_qa', qa_candidate_id: 'candidate-old',
      winget_id: 'Example.App', version: '1.0', architecture: 'x64',
      installer_sha256: 'A'.repeat(64), is_auto_update: true,
      package_config: { installerSha256: 'A'.repeat(64), architecture: 'x64' },
    });
    getPackageCompatibilityBlockMock.mockImplementation(async () => {
      const [column, key] = field.split('->>');
      if (field !== 'unchanged') {
        const value = field.includes('Sha256') || field === 'installer_sha256'
          ? 'B'.repeat(64) : field.includes('architecture') ? 'arm64' : 'candidate-new';
        if (key) (store.row[column] as Record<string, unknown>)[key] = value;
        else store.row[column] = value;
      }
      return { code: 'failed_managed_lifecycle' };
    });
    let jobReads = 0;
    createServerClientMock.mockReturnValue({ from: vi.fn((table: string) => {
      if (table === 'packaging_jobs') return ++jobReads === 1
        ? chain({ data: [structuredClone(store.row)], error: null }) : store.updateQuery();
      if (table === 'qa_candidates') return chain({ data: { status: 'passed', package_profile_sha256: 'C'.repeat(64) }, error: null });
      throw new Error(`Unexpected table ${table}`);
    }) });
    const response = await GET(new Request('https://example.test/api/cron/qa-resume', { headers: { authorization: 'Bearer secret' } }));
    const unchanged = field === 'unchanged';
    expect(await response.json()).toMatchObject({ resumed: 0, failed: unchanged ? 1 : 0 });
    expect(store.row.status).toBe(unchanged ? 'qa_failed' : 'awaiting_qa');
    if (unchanged) expect(handleAutoUpdateJobCompletionMock).toHaveBeenCalledOnce();
    else expect(handleAutoUpdateJobCompletionMock).not.toHaveBeenCalled();
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it.each([true, false])('checks and conditionally fails the row returned by a relink with localPackager=%s', async (localPackager) => {
    getFeatureFlagsMock.mockReturnValue({ localPackager });
    const store = jobStore({
      id: 'relinked-block', status: 'awaiting_qa', qa_candidate_id: 'candidate-old',
      winget_id: 'Example.App', version: '1.0', architecture: 'x64', installer_sha256: 'A'.repeat(64),
      package_config: { sourceType: 'winget', architecture: 'x64', installerSha256: 'A'.repeat(64) },
    });
    reconcileCatalogInstallerMock.mockImplementation(async (item) => ({
      item: { ...item, installerSha256: 'D'.repeat(64) }, trustedInstallers: [],
    }));
    ensureQaDemandMock.mockResolvedValue({
      state: 'passed', candidateId: 'candidate-new',
      identity: { executionProfileSha256: 'E'.repeat(64), presentationProfileSha256: 'F'.repeat(64) },
    });
    getPackageCompatibilityBlockMock.mockResolvedValue({ code: 'failed_managed_lifecycle' });
    let reads = 0;
    const client = { from: vi.fn((table: string) => {
      if (table === 'packaging_jobs') return ++reads === 1
        ? chain({ data: [structuredClone(store.row)], error: null }) : store.updateQuery();
      if (table === 'qa_candidates') return chain({ data: { status: 'superseded' }, error: null });
      throw new Error(`Unexpected table ${table}`);
    }) };
    createServerClientMock.mockReturnValue(client);
    const response = await GET(new Request('https://example.test/api/cron/qa-resume', { headers: { authorization: 'Bearer secret' } }));
    expect(await response.json()).toMatchObject({ resumed: 0, failed: 1 });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, {
      wingetId: 'Example.App', version: '1.0', architecture: 'x64', installerSha256: 'D'.repeat(64),
    });
    expect(store.writes[0].select).toHaveBeenCalledWith('qa_candidate_id, installer_sha256, architecture, package_config');
    expect(store.writes[1].eq).toHaveBeenCalledWith('qa_candidate_id', 'candidate-new');
    expect(store.row.status).toBe('qa_failed');
    expect(handleAutoUpdateJobCompletionMock).toHaveBeenCalledOnce();
  });

  it('uses SQL null filters for absent observed identity values', async () => {
    process.env.QA_MAINTENANCE_MODE = 'true';
    const store = jobStore({ id: 'null-identity', status: 'awaiting_qa', winget_id: 'Example.App', version: '1.0' });
    getPackageCompatibilityBlockMock.mockResolvedValue({ code: 'failed_managed_lifecycle' });
    let reads = 0;
    createServerClientMock.mockReturnValue({ from: vi.fn(() => ++reads === 1
      ? chain({ data: [structuredClone(store.row)], error: null }) : store.updateQuery()) });
    const response = await GET(new Request('https://example.test/api/cron/qa-resume', { headers: { authorization: 'Bearer secret' } }));
    expect(await response.json()).toMatchObject({ resumed: 0, failed: 1 });
    for (const column of ['qa_candidate_id', 'installer_sha256', 'architecture', 'package_config->>installerSha256', 'package_config->>architecture']) {
      expect(store.writes[0].is).toHaveBeenCalledWith(column, null);
      expect(store.writes[0].eq).not.toHaveBeenCalledWith(column, null);
    }
  });

  it.each([
    ['passed', true, false], ['passed', false, false],
    ['deferred', true, false], ['deferred', false, false],
    ['maintenance', true, false], ['maintenance', false, false],
    ['passed', true, true], ['passed', false, true],
    ['passed', true, false, false],
  ])('refuses a quarantined %s job with localPackager=%s and autoUpdate=%s', async (mode, localPackager, autoUpdate, rowUpdated = true) => {
    if (mode === 'deferred') {
      process.env.QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL = new Date(Date.now() + 60_000).toISOString();
    }
    if (mode === 'maintenance') process.env.QA_MAINTENANCE_MODE = 'true';
    getFeatureFlagsMock.mockReturnValue({ localPackager });
    getPackageCompatibilityBlockMock.mockResolvedValue({ code: 'failed_managed_lifecycle' });
    const job = {
      id: 'blocked-job', tenant_id: 'tenant-1', qa_candidate_id: 'candidate-1',
      winget_id: 'Example.App', version: '1.0', architecture: 'x86',
      installer_sha256: 'A'.repeat(64), is_auto_update: autoUpdate,
      package_config: { architecture: 'x64', installerSha256: 'B'.repeat(64) },
    };
    const update = chain({ data: rowUpdated ? { id: job.id } : null, error: null });
    let packagingCalls = 0;
    const client = { from: vi.fn((table: string) => {
      if (table === 'packaging_jobs') return ++packagingCalls === 1
        ? chain({ data: [job], error: null }) : update;
      if (table === 'qa_candidates') return chain({ data: {
        id: 'candidate-1', status: mode === 'deferred' ? 'queued' : 'passed',
        package_profile_sha256: 'C'.repeat(64), failure_summary: null,
      }, error: null });
      if (table === 'qa_package_results') return chain({ data: { outcome: 'Passed' }, error: null });
      throw new Error(`Unexpected table ${table}`);
    }) };
    createServerClientMock.mockReturnValue(client);
    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    expect(await response.json()).toMatchObject({ resumed: 0, failed: rowUpdated ? 1 : 0 });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, {
      wingetId: 'Example.App', version: '1.0', architecture: localPackager ? 'x86' : 'x64',
      installerSha256: (localPackager ? 'A' : 'B').repeat(64),
    });
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'qa_failed', status_message: PACKAGE_VERSION_UNAVAILABLE_MESSAGE,
    }));
    expect(update.eq).toHaveBeenCalledWith('status', 'awaiting_qa');
    expect(update.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }));
    expect(update.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'packaging' }));
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
    expect(assertCuratedLicenceAcceptedMock).not.toHaveBeenCalled();
    if (rowUpdated) {
      expect(handleAutoUpdateJobCompletionMock).toHaveBeenCalledWith(job.id, 'failed', PACKAGE_VERSION_UNAVAILABLE_MESSAGE);
    } else {
      expect(handleAutoUpdateJobCompletionMock).not.toHaveBeenCalled();
    }
  });

  it('holds an unverified compatibility lookup while releasing an unrelated verified job', async () => {
    getPackageCompatibilityBlockMock.mockRejectedValueOnce(new Error('lookup unavailable')).mockResolvedValueOnce(null);
    const jobs = ['unverified', 'verified'].map((id) => ({
      id, qa_candidate_id: id, winget_id: 'Example.App', version: '1.0',
      architecture: 'x64', installer_sha256: 'A'.repeat(64), package_config: {},
    }));
    const update = chain({ data: { id: 'verified' }, error: null });
    let packagingCalls = 0;
    createServerClientMock.mockReturnValue({ from: vi.fn((table: string) => {
      if (table === 'packaging_jobs') return ++packagingCalls === 1 ? chain({ data: jobs, error: null }) : update;
      if (table === 'qa_candidates') return chain({ data: { status: 'passed', package_profile_sha256: 'C'.repeat(64) }, error: null });
      if (table === 'qa_package_results') return chain({ data: { outcome: 'Passed' }, error: null });
      throw new Error(`Unexpected table ${table}`);
    }) });
    const response = await GET(new Request('https://example.test/api/cron/qa-resume', { headers: { authorization: 'Bearer secret' } }));
    expect(await response.json()).toMatchObject({ resumed: 1, failed: 0, waiting: 1 });
    expect(update.eq).toHaveBeenCalledWith('id', 'verified');
    expect(update.eq).not.toHaveBeenCalledWith('id', 'unverified');
    expect(handleAutoUpdateJobCompletionMock).not.toHaveBeenCalled();
  });

  it('atomically releases a waiting local-packager job after an exact QA pass', async () => {
    const job = {
      id: 'job-1',
      qa_candidate_id: 'candidate-1',
      execution_profile_sha256: 'A'.repeat(64),
      created_at: '2026-08-09T12:00:00Z',
    };
    const packagingUpdate = chain({ data: { id: 'job-1' }, error: null });
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          if (client.from.mock.calls.filter(([name]) => name === 'packaging_jobs').length === 1) {
            return chain({ data: [job], error: null });
          }
          return packagingUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-1',
              status: 'passed',
              failure_summary: null,
              package_profile_sha256: 'A'.repeat(64),
            },
            error: null,
          });
        }
        if (table === 'qa_package_results') {
          return chain({ data: { outcome: 'Passed' }, error: null });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 1, failed: 0, waiting: 0 });
    expect(packagingUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued',
      qa_completed_at: expect.any(String),
    }));
    expect(handleAutoUpdateJobCompletionMock).not.toHaveBeenCalled();
  });

  it('releases an existing customer upload while its queued QA lifecycle remains deferred', async () => {
    process.env.QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    getFeatureFlagsMock.mockReturnValue({ localPackager: false });
    triggerPackagingWorkflowMock.mockResolvedValue({
      runId: 123,
      runUrl: 'https://example.test/run/123',
    });
    const job = {
      id: 'job-deferred-customer',
      tenant_id: 'tenant-1',
      qa_candidate_id: 'candidate-queued',
      created_at: '2026-09-01T12:00:00Z',
      winget_id: 'Example.App',
      display_name: 'Example App',
      publisher: 'Example',
      version: '1.0.0',
      architecture: 'x64',
      installer_url: 'https://example.test/installer.exe',
      installer_sha256: 'A'.repeat(64),
      installer_type: 'exe',
      install_command: 'installer.exe /silent',
      uninstall_command: 'installer.exe /uninstall /silent',
      install_scope: 'machine',
      package_config: {
        sourceType: 'winget',
        displayName: 'Example App',
        publisher: 'Example',
        architecture: 'x64',
        installerUrl: 'https://example.test/installer.exe',
        installerSha256: 'A'.repeat(64),
        installerType: 'exe',
        installCommand: 'installer.exe /silent',
        uninstallCommand: 'installer.exe /uninstall /silent',
      },
      is_auto_update: false,
    };
    const claimUpdate = chain({ data: { id: job.id }, error: null });
    const provenanceUpdate = chain({ data: null, error: null });
    let packagingCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          packagingCall++;
          if (packagingCall === 1) return chain({ data: [job], error: null });
          if (packagingCall === 2) return claimUpdate;
          return provenanceUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-queued',
              status: 'queued',
              failure_summary: null,
              package_profile_sha256: 'B'.repeat(64),
            },
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 1, failed: 0, waiting: 0 });
    expect(claimUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'packaging',
      status_message: 'Preparing deployment while installation validation remains scheduled',
      qa_completed_at: null,
    }));
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(1);
  });

  it('resumes existing customer uploads without querying or creating QA in maintenance', async () => {
    process.env.QA_MAINTENANCE_MODE = 'true';
    getFeatureFlagsMock.mockReturnValue({ localPackager: false });
    triggerPackagingWorkflowMock.mockResolvedValue({
      runId: 123,
      runUrl: 'https://example.test/run/123',
    });
    const job = {
      id: 'job-deferred-customer',
      tenant_id: 'tenant-1',
      qa_candidate_id: 'candidate-queued',
      created_at: '2026-09-01T12:00:00Z',
      winget_id: 'Example.App',
      display_name: 'Example App',
      publisher: 'Example',
      version: '1.0.0',
      architecture: 'x64',
      installer_url: 'https://example.test/installer.exe',
      installer_sha256: 'A'.repeat(64),
      installer_type: 'exe',
      install_command: 'installer.exe /silent',
      uninstall_command: 'installer.exe /uninstall /silent',
      install_scope: 'machine',
      package_config: {
        sourceType: 'winget',
        displayName: 'Example App',
        publisher: 'Example',
        architecture: 'x64',
        installerUrl: 'https://example.test/installer.exe',
        installerSha256: 'A'.repeat(64),
        installerType: 'exe',
        installCommand: 'installer.exe /silent',
        uninstallCommand: 'installer.exe /uninstall /silent',
      },
      is_auto_update: false,
    };
    const claimUpdate = chain({ data: { id: job.id }, error: null });
    const provenanceUpdate = chain({ data: null, error: null });
    let packagingCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          packagingCall++;
          if (packagingCall === 1) return chain({ data: [job], error: null });
          if (packagingCall === 2) return claimUpdate;
          return provenanceUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-queued',
              status: 'queued',
              failure_summary: null,
              package_profile_sha256: 'B'.repeat(64),
            },
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 1, failed: 0, waiting: 0 });
    expect(claimUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'packaging',
      status_message: 'Preparing deployment',
      qa_completed_at: null,
    }));
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({ qaOverride: true }));
    expect(ensureQaDemandMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalledWith('qa_candidates');
  });

  it('keeps automatic updates waiting during customer continuity and maintenance', async () => {
    process.env.QA_MAINTENANCE_MODE = 'true';
    process.env.QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    const job = {
      id: 'job-auto-update',
      qa_candidate_id: 'candidate-queued',
      created_at: '2026-09-01T12:00:00Z',
      is_auto_update: true,
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') return chain({ data: [job], error: null });
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-queued',
              status: 'queued',
              failure_summary: null,
              package_profile_sha256: 'B'.repeat(64),
            },
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(body).toMatchObject({ resumed: 0, failed: 0, waiting: 1 });
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('finalizes auto-update tracking when the required QA candidate fails', async () => {
    const job = {
      id: 'job-failed-qa',
      qa_candidate_id: 'candidate-failed',
      execution_profile_sha256: 'A'.repeat(64),
      created_at: '2026-08-09T12:00:00Z',
    };
    const packagingUpdate = chain({ data: { id: job.id }, error: null });
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          if (client.from.mock.calls.filter(([name]) => name === 'packaging_jobs').length === 1) {
            return chain({ data: [job], error: null });
          }
          return packagingUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-failed',
              status: 'failed',
              failure_summary: 'Installer remained interactive.',
              package_profile_sha256: 'A'.repeat(64),
            },
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 0, failed: 1, waiting: 0 });
    expect(packagingUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'qa_failed',
      status_message: 'Installer remained interactive.',
    }));
    expect(handleAutoUpdateJobCompletionMock).toHaveBeenCalledWith(
      job.id,
      'failed',
      'Installer remained interactive.'
    );
  });

  it.each([true, false])('rebuilds a superseded exact QA profile when relink matches=%s', async (matches) => {
    const job = {
      id: 'job-superseded',
      qa_candidate_id: 'candidate-old',
      execution_profile_sha256: 'A'.repeat(64),
      status_message: 'Waiting',
      created_at: '2026-08-09T12:00:00Z',
      winget_id: 'Example.App',
      display_name: 'Example App',
      publisher: 'Example',
      version: '2.0.0',
      architecture: 'x64',
      installer_url: 'https://example.test/installer.msi',
      installer_sha256: 'C'.repeat(64),
      installer_type: 'wix',
      install_command: 'msiexec /i installer.msi /qn',
      uninstall_command: 'msiexec /x {11111111-1111-1111-1111-111111111111} /qn',
      install_scope: 'machine',
      package_config: { psadtConfig: {}, detectionRules: [] },
      is_auto_update: false,
    };
    ensureQaDemandMock.mockResolvedValue({
      state: 'waiting',
      candidateId: 'candidate-current',
      identity: {
        executionProfileSha256: 'B'.repeat(64),
        presentationProfileSha256: 'D'.repeat(64),
      },
    });
    const relinkUpdate = chain({ data: matches ? { ...job, qa_candidate_id: 'candidate-current' } : null, error: null });
    let packagingCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          packagingCall++;
          if (packagingCall === 1) return chain({ data: [job], error: null });
          return relinkUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-old',
              status: 'superseded',
              failure_summary: null,
              package_profile_sha256: 'A'.repeat(64),
            },
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 0, failed: 0, waiting: matches ? 1 : 0 });
    if (!matches) {
      expect(getPackageCompatibilityBlockMock).not.toHaveBeenCalled();
      expect(packagingCall).toBe(2);
    }
    expect(ensureQaDemandMock).toHaveBeenCalledWith(client, expect.objectContaining({
      wingetId: 'Example.App',
      priority: QA_PRIORITY_CUSTOMER,
      demandSource: 'customer',
    }));
    expect(relinkUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      qa_candidate_id: 'candidate-current',
      execution_profile_sha256: 'B'.repeat(64),
      presentation_profile_sha256: 'D'.repeat(64),
    }));
  });

  it.each([false, true])('refreshes trusted manifest switches and checks the refreshed payload block=%s', async (blocked) => {
    const oldCommand = 'msiexec /i Macabacus-9.9.2.msi /qn /norestart';
    const refreshedCommand =
      'msiexec /i Macabacus-9.9.2.msi /qn /norestart OFFICE2016X64FOUND=1 EULA=1 ALLUSERS=1';
    const job = {
      id: 'job-stale-manifest-command',
      qa_candidate_id: 'candidate-stale-toolchain',
      execution_profile_sha256: 'A'.repeat(64),
      status_message: 'Waiting',
      created_at: '2026-08-28T20:00:00Z',
      winget_id: 'Macabacus.Macabacus',
      display_name: 'Macabacus',
      publisher: 'Macabacus',
      version: '9.9.2',
      architecture: 'x64',
      installer_url: 'https://example.test/Macabacus-9.9.2.msi',
      installer_sha256: 'C'.repeat(64),
      installer_type: 'wix',
      install_command: oldCommand,
      uninstall_command: 'msiexec /x {11111111-1111-1111-1111-111111111111} /qn',
      install_scope: 'machine',
      package_config: {
        wingetId: 'Macabacus.Macabacus',
        displayName: 'Macabacus',
        publisher: 'Macabacus',
        version: '9.9.2',
        architecture: 'x64',
        installerUrl: 'https://example.test/Macabacus-9.9.2.msi',
        installerSha256: 'C'.repeat(64),
        installerType: 'wix',
        installCommand: oldCommand,
        uninstallCommand: 'msiexec /x {11111111-1111-1111-1111-111111111111} /qn',
        installScope: 'machine',
        sourceType: 'winget',
        psadtConfig: {},
        detectionRules: [],
      },
      is_auto_update: false,
    };
    reconcileCatalogInstallerMock.mockResolvedValue({
      item: {
        ...job.package_config,
        installCommand: refreshedCommand,
        installerSha256: 'D'.repeat(64),
      },
      trustedInstallers: [],
    });
    ensureQaDemandMock.mockResolvedValue({
      state: 'waiting',
      candidateId: 'candidate-current-manifest',
      identity: {
        executionProfileSha256: 'B'.repeat(64),
        presentationProfileSha256: 'D'.repeat(64),
      },
    });
    getPackageCompatibilityBlockMock.mockResolvedValue(blocked ? { code: 'failed_managed_lifecycle' } : null);
    const relinkUpdate = chain({ data: {
      ...job, qa_candidate_id: 'candidate-current-manifest', installer_sha256: 'D'.repeat(64),
      package_config: { ...job.package_config, installerSha256: 'D'.repeat(64) },
    }, error: null });
    let packagingCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          packagingCall++;
          if (packagingCall === 1) return chain({ data: [job], error: null });
          return relinkUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-stale-toolchain',
              status: 'superseded',
              failure_summary: null,
              package_profile_sha256: 'A'.repeat(64),
            },
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 0, failed: blocked ? 1 : 0, waiting: blocked ? 0 : 1 });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, {
      wingetId: job.winget_id, version: job.version, architecture: job.architecture,
      installerSha256: 'D'.repeat(64),
    });
    expect(reconcileCatalogInstallerMock).toHaveBeenCalledWith(expect.objectContaining({
      wingetId: 'Macabacus.Macabacus',
      version: '9.9.2',
      installCommand: oldCommand,
    }));
    expect(ensureQaDemandMock).toHaveBeenCalledWith(client, expect.objectContaining({
      silentSwitches: '/qn /norestart OFFICE2016X64FOUND=1 EULA=1 ALLUSERS=1',
    }));
    expect(relinkUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      qa_candidate_id: 'candidate-current-manifest',
      install_command: refreshedCommand,
      package_config: expect.objectContaining({ installCommand: refreshedCommand }),
    }));
  });

  it('rebuilds a legacy waiting job that has no QA candidate link', async () => {
    const job = {
      id: 'job-unlinked',
      qa_candidate_id: null,
      execution_profile_sha256: 'A'.repeat(64),
      status_message: 'Testing the app installation before upload',
      created_at: '2026-08-09T12:00:00Z',
      winget_id: 'Example.Legacy',
      display_name: 'Example Legacy',
      publisher: 'Example',
      version: '2.0.0',
      architecture: 'x64',
      installer_url: 'https://example.test/installer.exe',
      installer_sha256: 'C'.repeat(64),
      installer_type: 'exe',
      install_command: 'installer.exe /silent',
      uninstall_command: 'installer.exe /uninstall',
      install_scope: 'machine',
      package_config: { psadtConfig: {}, detectionRules: [] },
      is_auto_update: false,
    };
    ensureQaDemandMock.mockResolvedValue({
      state: 'waiting',
      candidateId: 'candidate-recovered',
      identity: {
        executionProfileSha256: 'B'.repeat(64),
        presentationProfileSha256: 'D'.repeat(64),
      },
    });
    const relinkUpdate = chain({ data: { ...job, qa_candidate_id: 'candidate-recovered' }, error: null });
    let packagingCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'qa_candidates') return candidateQuery([
          { id: 'candidate-recovered', status: 'queued' },
        ]);
        if (table !== 'packaging_jobs') throw new Error(`Unexpected table ${table}`);
        packagingCall++;
        if (packagingCall === 1) return chain({ data: [job], error: null });
        return relinkUpdate;
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 0, failed: 0, waiting: 1 });
    expect(ensureQaDemandMock).toHaveBeenCalledWith(client, expect.objectContaining({
      wingetId: 'Example.Legacy',
      priority: QA_PRIORITY_CUSTOMER,
      demandSource: 'customer',
    }));
    expect(relinkUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      qa_candidate_id: 'candidate-recovered',
      execution_profile_sha256: 'B'.repeat(64),
      presentation_profile_sha256: 'D'.repeat(64),
    }));
    expect(client.from).toHaveBeenCalledWith('qa_candidates');
  });

  it.each(['missing', 'superseded'].flatMap((prior) =>
    ['publishing', 'queued', 'missing'].map((current) => ({ prior, current }))))(
    'checks actual candidate after relinking during continuity: %j', async ({ prior, current }) => {
    process.env.QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL = new Date(Date.now() + 60_000).toISOString();
    getFeatureFlagsMock.mockReturnValue({ localPackager: false });
    const job = {
      id: 'job-relinked-publication', status: 'awaiting_qa',
      qa_candidate_id: prior === 'missing' ? null : 'old-candidate',
      winget_id: 'Example.App', version: '1.0.0', architecture: 'x64',
      installer_sha256: 'B'.repeat(64), is_auto_update: false,
      installer_url: 'https://example.test/installer.exe', installer_type: 'exe',
      package_config: { sourceType: 'custom', psadtConfig: {}, detectionRules: [] },
    };
    ensureQaDemandMock.mockResolvedValue({ state: 'waiting', candidateId: 'publication-candidate',
      identity: { executionProfileSha256: 'A'.repeat(64), presentationProfileSha256: 'C'.repeat(64) } });
    const store = jobStore(job);
    let reads = 0;
    createServerClientMock.mockReturnValue({ from: vi.fn((table: string) => {
      if (table === 'packaging_jobs') return ++reads === 1
        ? chain({ data: [structuredClone(job)], error: null }) : store.updateQuery();
      if (table === 'qa_candidates') return candidateQuery([
        { id: 'old-candidate', status: 'superseded' },
        ...(current === 'missing' ? [] : [{ id: 'publication-candidate',
          status: current === 'publishing' ? 'error' : 'queued',
          phase: current === 'publishing' ? 'publishing' : null,
          github_run_id: current === 'publishing' ? '123456789' : null,
          package_profile_sha256: 'A'.repeat(64) }]),
      ]);
      throw new Error(`Unexpected table ${table}`);
    }) });
    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const released = current === 'queued';
    expect(await response.json()).toEqual({ success: true, scanned: 1,
      resumed: released ? 1 : 0, failed: 0, waiting: released ? 0 : 1 });
    expect(store.row.qa_candidate_id).toBe('publication-candidate');
    expect(store.row.status).toBe(released ? 'packaging' : 'awaiting_qa');
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(released ? 1 : 0);
    expect(handleAutoUpdateJobCompletionMock).not.toHaveBeenCalled();
    expect(assertCuratedLicenceAcceptedMock).not.toHaveBeenCalled();
    expect(store.writes).toHaveLength(released ? 3 : 1);
  });

  it('releases an unlinked upload immediately when the app payload already passed QA', async () => {
    const job = {
      id: 'job-already-passed',
      qa_candidate_id: null,
      execution_profile_sha256: 'A'.repeat(64),
      status_message: 'Testing the app installation before upload',
      created_at: '2026-08-09T12:00:00Z',
      winget_id: 'Google.Chrome',
      display_name: 'Google Chrome',
      publisher: 'Google',
      version: '151.0.7922.109',
      architecture: 'x64',
      installer_url: 'https://example.test/chrome.msi',
      installer_sha256: 'C'.repeat(64),
      installer_type: 'wix',
      install_command: 'msiexec /i chrome.msi /qn',
      uninstall_command: 'msiexec /x {11111111-1111-1111-1111-111111111111} /qn',
      install_scope: 'machine',
      package_config: { psadtConfig: { deployMode: 'Interactive' }, detectionRules: [] },
      is_auto_update: false,
    };
    ensureQaDemandMock.mockResolvedValue({
      state: 'passed',
      candidateId: null,
      identity: {
        executionProfileSha256: 'B'.repeat(64),
        presentationProfileSha256: 'D'.repeat(64),
      },
    });
    const relinkUpdate = chain({ data: job, error: null });
    const claimUpdate = chain({ data: { id: job.id }, error: null });
    let packagingCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'packaging_jobs') throw new Error(`Unexpected table ${table}`);
        packagingCall++;
        if (packagingCall === 1) return chain({ data: [job], error: null });
        if (packagingCall === 2) return relinkUpdate;
        return claimUpdate;
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 1, failed: 0, waiting: 0 });
    expect(claimUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued',
      qa_completed_at: expect.any(String),
    }));
    expect(client.from).not.toHaveBeenCalledWith('qa_candidates');
    expect(client.from).not.toHaveBeenCalledWith('qa_package_results');
  });

  it('finalizes auto-update tracking when packaging dispatch fails after QA passes', async () => {
    getFeatureFlagsMock.mockReturnValue({ localPackager: false });
    triggerPackagingWorkflowMock.mockRejectedValue(new Error('GitHub dispatch unavailable'));
    const job = {
      id: 'job-dispatch-failed',
      qa_candidate_id: 'candidate-passed',
      execution_profile_sha256: 'B'.repeat(64),
      created_at: '2026-08-09T12:00:00Z',
      winget_id: 'Example.App',
      display_name: 'Example App',
      version: '1.0.0',
      installer_url: 'https://example.test/installer.exe',
      installer_type: 'exe',
      install_command: 'installer.exe /silent',
      package_config: {},
    };
    const claimUpdate = chain({ data: { id: job.id }, error: null });
    const failedUpdate = chain({ data: { id: job.id }, error: null });
    let packagingCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          packagingCall++;
          if (packagingCall === 1) return chain({ data: [job], error: null });
          if (packagingCall === 2) return claimUpdate;
          return failedUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({
            data: {
              id: 'candidate-passed',
              status: 'passed',
              failure_summary: null,
              package_profile_sha256: 'B'.repeat(64),
            },
            error: null,
          });
        }
        if (table === 'qa_package_results') {
          return chain({ data: { outcome: 'Passed' }, error: null });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    createServerClientMock.mockReturnValue(client);

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resumed: 0, failed: 1, waiting: 0 });
    expect(failedUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error_code: 'QA_RESUME_DISPATCH_FAILED',
      error_message: 'GitHub dispatch unavailable',
    }));
    expect(handleAutoUpdateJobCompletionMock).toHaveBeenCalledWith(
      job.id,
      'failed',
      'GitHub dispatch unavailable'
    );
  });

  it('fails a resumed curated job with a licence reason when the tenant has not accepted the agreement', async () => {
    getFeatureFlagsMock.mockReturnValue({ localPackager: false });
    const acrobat = CURATED_APPS.find(app => app.id === 'acrobat-reader')!;
    const licenceError = new CuratedLicenceError(acrobat, acrobat.licenceAttestation!);
    triggerPackagingWorkflowMock.mockRejectedValue(licenceError);
    const job = {
      id: 'job-licence', qa_candidate_id: 'candidate-passed', is_auto_update: true,
      created_at: '2026-08-09T12:00:00Z', winget_id: acrobat.packageId, tenant_id: 'tenant-1',
      display_name: acrobat.name, version: '120.0.0.0', installer_url: 'https://example.test/installer.exe',
      installer_type: 'exe', install_command: 'installer.exe /sAll', package_config: { sourceType: 'curated' },
    };
    const failedUpdate = chain({ data: { id: job.id }, error: null });
    let packagingCall = 0;
    createServerClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          packagingCall++;
          if (packagingCall === 1) return chain({ data: [job], error: null });
          if (packagingCall === 2) return chain({ data: { id: job.id }, error: null });
          return failedUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({ data: { id: 'candidate-passed', status: 'passed', failure_summary: null, package_profile_sha256: 'B'.repeat(64) }, error: null });
        }
        if (table === 'qa_package_results') return chain({ data: { outcome: 'Passed' }, error: null });
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));

    expect(await response.json()).toMatchObject({ resumed: 0, failed: 1 });
    expect(failedUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', error_code: 'CURATED_LICENCE_NOT_ACCEPTED', error_message: licenceError.message,
    }));
    expect(handleAutoUpdateJobCompletionMock).toHaveBeenCalledWith(job.id, 'failed', licenceError.message);
  });

  it('fails a local-packager curated job before release when the tenant has not accepted the agreement', async () => {
    const acrobat = CURATED_APPS.find(app => app.id === 'acrobat-reader')!;
    const licenceError = new CuratedLicenceError(acrobat, acrobat.licenceAttestation!);
    assertCuratedLicenceAcceptedMock.mockRejectedValue(licenceError);
    const job = {
      id: 'job-local-licence', qa_candidate_id: 'candidate-passed', is_auto_update: true,
      created_at: '2026-08-09T12:00:00Z', winget_id: acrobat.packageId, tenant_id: 'tenant-1',
    };
    const failedUpdate = chain({ data: { id: job.id }, error: null });
    let packagingCall = 0;
    createServerClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'packaging_jobs') {
          packagingCall++;
          return packagingCall === 1 ? chain({ data: [job], error: null }) : failedUpdate;
        }
        if (table === 'qa_candidates') {
          return chain({ data: { id: 'candidate-passed', status: 'passed', failure_summary: null, package_profile_sha256: 'C'.repeat(64) }, error: null });
        }
        if (table === 'qa_package_results') return chain({ data: { outcome: 'Passed' }, error: null });
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const response = await GET(new Request('https://example.test/api/cron/qa-resume', {
      headers: { authorization: 'Bearer secret' },
    }));

    expect(await response.json()).toMatchObject({ resumed: 0, failed: 1 });
    expect(assertCuratedLicenceAcceptedMock).toHaveBeenCalledWith('tenant-1', acrobat.packageId);
    expect(failedUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', error_code: 'CURATED_LICENCE_NOT_ACCEPTED',
    }));
    expect(failedUpdate.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }));
    expect(handleAutoUpdateJobCompletionMock).toHaveBeenCalledWith(job.id, 'failed', licenceError.message);
  });
});
