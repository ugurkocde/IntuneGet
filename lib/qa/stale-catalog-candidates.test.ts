import { expect, it } from 'vitest';
import { isStaleQaCatalogCandidate, loadStaleQaCatalogCandidateIds, type QaQueueCandidate } from './queue-selection';

const candidate = (patch: Partial<QaQueueCandidate> = {}): QaQueueCandidate => ({
  id: '00000000-0000-4000-8000-000000000001', winget_id: 'Example.App', version: '3.0.14',
  architecture: 'x64', installer_sha256: 'A'.repeat(64), package_profile_sha256: 'B'.repeat(64),
  status: 'queued', test_level: 'psadt-package', demand_source: 'managed', catalog_version_at_enqueue: '3.0.13',
  test_config: { profileKind: 'catalog-default' }, priority: 100, enqueued_at: '2026-10-23T00:00:00Z', ...patch,
});

it('recognizes the released stale background shape without ordering versions', () => {
  expect(isStaleQaCatalogCandidate(candidate(), '3.0.17')).toBe(true);
});

it.each([
  ['catalog still equals snapshot', { version: '3.0.17', catalog_version_at_enqueue: '3.0.15' }, '3.0.15'],
  ['catalog equals candidate after promotion', {}, '3.0.14'],
  ['customer', { demand_source: 'customer' }, '3.0.17'],
  ['auto update', { demand_source: 'auto_update' }, '3.0.17'],
  ['operator', { demand_source: 'operator' }, '3.0.17'],
  ['unknown source', { demand_source: undefined }, '3.0.17'],
  ['deployment profile', { test_config: { profileKind: 'deployment-config' } }, '3.0.17'],
  ['missing profile', { test_config: {} }, '3.0.17'],
  ['terminal publishing row', { status: 'error' }, '3.0.17'],
  ['active row', { status: 'running' }, '3.0.17'],
  ['other test level', { test_level: 'installer-preflight' }, '3.0.17'],
  ['missing snapshot', { catalog_version_at_enqueue: null }, '3.0.17'],
  ['empty snapshot', { catalog_version_at_enqueue: '' }, '3.0.17'],
  ['missing catalog', {}, null], ['empty catalog', {}, ''],
] as const)('preserves %s', (_label, patch, current) => {
  expect(isStaleQaCatalogCandidate(candidate(patch), current)).toBe(false);
});

it.each(['catalog', 'managed'])('accepts only the explicit background source %s', demand_source => {
  expect(isStaleQaCatalogCandidate(candidate({ demand_source }), '3.0.17')).toBe(true);
});
it.each(['3.0.9', '3.0.10', '1.0', '1.0.0.0', 'v2-beta', '2026.10.30'])('never sorts or normalizes version %s', version => {
  expect(isStaleQaCatalogCandidate(candidate({ version }), version)).toBe(false);
  expect(isStaleQaCatalogCandidate(candidate({ version, catalog_version_at_enqueue: version }), version)).toBe(false);
});
it('keeps different hashes and architectures when the exact version is current', () => {
  for (const architecture of ['x86', 'x64']) expect(isStaleQaCatalogCandidate(candidate({ architecture, installer_sha256: 'C'.repeat(64) }), '3.0.14')).toBe(false);
  expect(isStaleQaCatalogCandidate(candidate({ architecture: 'x86' }), '3.0.17')).toBe(true);
});

function fixture() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    curated_apps: [{ winget_id: 'Example.App', latest_version: '3.0.17' }],
    qa_retest_grants: [], qa_repair_requests: [], packaging_jobs: [],
  };
  const errors = new Set<string>(); let nullTable: string | undefined;
  const client = { from(table: string) {
    let limit = Infinity; const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const builder = {
      select() { return builder; },
      in(key: string, values: unknown[]) { filters.push(r => values.includes(r[key])); return builder; },
      limit(value: number) { limit = value; return builder; },
      then(resolve: (r: unknown) => unknown) { return Promise.resolve({
        data: table === nullTable ? null : tables[table].filter(r => filters.every(f => f(r))).slice(0, limit),
        error: errors.has(table) ? { message: 'unavailable' } : null,
      }).then(resolve); },
    }; return builder;
  } };
  return { tables, errors, client, nullData(table: string) { nullTable = table; } };
}

it('loads the stale ids once without using Passed status as approval', async () => {
  const f = fixture(); expect(await loadStaleQaCatalogCandidateIds(f.client as never, [candidate()])).toEqual(new Set([candidate().id]));
});
it.each(['qa_retest_grants', 'qa_repair_requests'])('preserves any %s row, including expired or resolved history', async table => {
  const f = fixture(); f.tables[table].push({ candidate_id: candidate().id, closed_at: '2000-01-01', status: 'resolved' });
  expect(await loadStaleQaCatalogCandidateIds(f.client as never, [candidate()])).toEqual(new Set());
});
it.each(['awaiting_qa', 'queued', 'packaging'])('preserves linked or exact-payload customer work in %s', async status => {
  for (const linked of [true, false]) {
    const f = fixture(); f.tables.packaging_jobs.push(linked ? { status, qa_candidate_id: candidate().id, version: 'other' } : {
      status, qa_candidate_id: 'other-candidate', winget_id: 'example.app', version: '3.0.14', architecture: 'x64', installer_sha256: 'a'.repeat(64),
    });
    expect(await loadStaleQaCatalogCandidateIds(f.client as never, [candidate()])).toEqual(new Set());
  }
});
it('does not exempt a different architecture or a terminal customer job', async () => {
  const f = fixture(); f.tables.packaging_jobs.push({ status: 'awaiting_qa', winget_id: 'Example.App', version: '3.0.14', architecture: 'x86', installer_sha256: 'A'.repeat(64) }, { status: 'completed', qa_candidate_id: candidate().id });
  expect(await loadStaleQaCatalogCandidateIds(f.client as never, [candidate()])).toEqual(new Set([candidate().id]));
});
it('exempts only the linked customer row while another stale background row remains actionable', async () => {
  const f = fixture(), other = candidate({ id: '00000000-0000-4000-8000-000000000002', winget_id: 'Other.App' });
  f.tables.curated_apps.push({ winget_id: other.winget_id, latest_version: '3.0.17' });
  f.tables.packaging_jobs.push({ status: 'awaiting_qa', qa_candidate_id: candidate().id, version: 'other' });
  expect(await loadStaleQaCatalogCandidateIds(f.client as never, [candidate(), other])).toEqual(new Set([other.id]));
});
it.each(['curated_apps', 'qa_retest_grants', 'qa_repair_requests', 'packaging_jobs'])('throws rather than superseding when %s lookup fails', async table => {
  const f = fixture(); f.errors.add(table);
  await expect(loadStaleQaCatalogCandidateIds(f.client as never, [candidate()])).rejects.toThrow('supersession evidence is unavailable');
});
it('preserves the whole chunk when a lookup reaches its row limit', async () => {
  const f = fixture(); f.tables.qa_retest_grants.push(...Array.from({ length: 1000 }, () => ({ candidate_id: candidate().id })));
  expect(await loadStaleQaCatalogCandidateIds(f.client as never, [candidate()])).toEqual(new Set());
});
it('preserves unknown and ambiguous bindings', async () => {
  for (const kind of ['null', 'duplicate', 'missing']) {
    const f = fixture();
    if (kind === 'null') f.nullData('packaging_jobs');
    if (kind === 'duplicate') f.tables.curated_apps.push({ winget_id: 'Example.App', latest_version: '3.0.18' });
    if (kind === 'missing') f.tables.curated_apps.length = 0;
    expect(await loadStaleQaCatalogCandidateIds(f.client as never, [candidate()])).toEqual(new Set());
  }
});
