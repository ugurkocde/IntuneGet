import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchReaderStaticScan } from './dispatch';

const { preflight, intent, config } = vi.hoisted(() => ({
  preflight: vi.fn(), intent: vi.fn(), config: vi.fn(),
}));
vi.mock('@/lib/github-actions', () => ({ getGitHubActionsConfig: config }));
vi.mock('@/lib/installer-preflight', () => ({ enforceInstallerPreflight: preflight }));
vi.mock('@/lib/qa/submission-intent', () => ({ recordPublicSubmissionIntent: intent }));

const candidate = {
  id: 'de979d31-562f-40ef-9dd1-3752fa091953', status: 'queued',
  winget_id: 'Adobe.Acrobat.Reader.64-bit', version: '26.003.22075', architecture: 'x64',
  test_level: 'psadt-package',
  installer_sha256: '7BEC66953457F6BC78BCE9F0A1DCDDE1C4CF2A8F8AC26F73FCECF5738F42F307',
  installer_url: 'https://ardownload2.adobe.com/pub/adobe/acrobat/win/AcrobatDC/2600322075/AcroRdrDCx642600322075_MUI.exe',
  package_profile_sha256: 'BE9876C429C9ADB461675ADC80E58E7890A7F5F41C26275BDD3DDA694C48CDCA',
};
function database(overrides: Record<string, unknown> = {}, errorTable = '') {
  const rows: Record<string, unknown> = {
    qa_candidates: { ...candidate },
    qa_installer_security_holds: { malicious_verdicts: 0, released_at: null },
    qa_vt_requests: [], ...overrides,
  };
  const filters: unknown[][] = [];
  const from = vi.fn((table: string) => {
    const result = { data: rows[table], error: table === errorTable ? { message: 'unavailable' } : null };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'gte', 'limit']) {
      builder[method] = (...args: unknown[]) => { filters.push([table, method, ...args]); return builder; };
    }
    builder.maybeSingle = async () => result;
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  });
  const rpc = vi.fn(() => { throw Error('No RPC is allowed in scan-only dispatch'); });
  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc, filters };
}
const history = (workflow_runs: unknown[] = [], total_count = workflow_runs.length) =>
  new Response(JSON.stringify({ total_count, workflow_runs }), { status: 200 });

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime('2026-11-13T10:00:00Z');
  config.mockReturnValue({ owner: 'ugurkocde', workflowsRepo: 'IntuneGet-Workflows', ref: 'main', token: 'fixture-only' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('idle Reader static dispatch', () => {
  it('uses only read preconditions and sends no lifecycle payload, preflight or intent', async () => {
    const db = database(), fetchMock = vi.fn().mockResolvedValueOnce(history()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await dispatchReaderStaticScan(db.client)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ref: 'main', inputs: {
      smoke_test: 'false', candidate_label: 'Reader static scan-only', reader_static_scan: 'true',
    } });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
    expect(db.filters).toContainEqual(['qa_vt_requests', 'eq', 'candidate_id', candidate.id]);
    expect(db.filters).toContainEqual(['qa_vt_requests', 'eq', 'operation', 'hash_lookup']);
    expect(db.filters).toContainEqual(['qa_vt_requests', 'is', 'recheck_lease', null]);
    expect(db.filters).toContainEqual(['qa_vt_requests', 'gte', 'reserved_at', '2026-11-11T00:00:00Z']);
    expect(preflight).not.toHaveBeenCalled(); expect(intent).not.toHaveBeenCalled(); expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['status', 'running'], ['winget_id', 'Other.App'], ['version', '26.003.22076'],
    ['architecture', 'x86'], ['test_level', 'installer-preflight'],
    ['installer_sha256', '0'.repeat(64)], ['installer_url', 'https://example.invalid/other'],
    ['package_profile_sha256', '0'.repeat(64)],
  ])('refuses candidate drift in %s without any network call', async (field, value) => {
    const db = database({ qa_candidates: { ...candidate, [field]: value } });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect(await dispatchReaderStaticScan(db.client)).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { qa_candidates: null }, { qa_installer_security_holds: null },
    { qa_installer_security_holds: { released_at: '2026-11-11T09:00:00Z', malicious_verdicts: 0 } },
    { qa_installer_security_holds: { released_at: null, malicious_verdicts: 1 } },
    { qa_vt_requests: [{ id: 'prior-reservation' }] }, { qa_vt_requests: null },
  ])('refuses missing bindings, changed holds or an existing one-shot row', async overrides => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect(await dispatchReaderStaticScan(database(overrides).client)).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['qa_candidates', 'qa_installer_security_holds', 'qa_vt_requests'])('refuses a %s read error', async table => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect(await dispatchReaderStaticScan(database({}, table).client)).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses any earlier static run, including cancelled runs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(history([{ id: 1, display_title: 'Reader static scan-only', created_at: '2026-11-11T01:00:00Z', conclusion: 'cancelled' }]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await dispatchReaderStaticScan(database().client)).toBe(false); expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([new Response(null, { status: 500 }), new Response('{}'), history([], 1), history([], 1001)])('refuses unavailable or incomplete history', async response => {
    const fetchMock = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', fetchMock);
    expect(await dispatchReaderStaticScan(database().client)).toBe(false);
    expect(fetchMock.mock.calls.every(call => call[1].method === 'GET')).toBe(true);
  });

  it('checks every history page before dispatch', async () => {
    const runs = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, display_title: 'ordinary', created_at: '2026-11-11T01:00:00Z' }));
    const fetchMock = vi.fn().mockResolvedValueOnce(history(runs, 101)).mockResolvedValueOnce(history([{ id: 101, display_title: 'Reader static scan-only', created_at: '2026-11-11T02:00:00Z' }], 101));
    vi.stubGlobal('fetch', fetchMock);
    expect(await dispatchReaderStaticScan(database().client)).toBe(false); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses after the deadline without reading or dispatching', async () => {
    vi.setSystemTime('2026-11-14T08:00:00Z'); const db = database(), fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect(await dispatchReaderStaticScan(db.client)).toBe(false); expect(db.from).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechecks the deadline after history reads', async () => {
    const fetchMock = vi.fn().mockImplementation(() => { vi.setSystemTime('2026-11-14T08:00:00Z'); return Promise.resolve(history()); });
    vi.stubGlobal('fetch', fetchMock);
    expect(await dispatchReaderStaticScan(database().client)).toBe(false); expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuses an unavailable credential or transport without ordinary fallback', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('transport unavailable')); vi.stubGlobal('fetch', fetchMock);
    expect(await dispatchReaderStaticScan(database().client)).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce(); expect(preflight).not.toHaveBeenCalled(); expect(intent).not.toHaveBeenCalled();
    config.mockImplementationOnce(() => { throw new Error('credential unavailable'); }); fetchMock.mockClear();
    expect(await dispatchReaderStaticScan(database().client)).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
  });
});
