import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ claim: vi.fn(), update: vi.fn(), gate: vi.fn(), configured: vi.fn(), realAdapter: false, dependencies: vi.fn(), actualGate: null as typeof import('@/lib/qa/gate').enforceQaGate | null, fetch: vi.fn(), row: {} as Record<string, unknown> }));
vi.mock('@/lib/db', async () => { const { supabaseDb } = await import('@/lib/db/supabase-adapter'); return { getDatabase: () => state.realAdapter ? supabaseDb : ({ jobs: { claim: state.claim, update: state.update } }), verifyPackagerApiKey: () => true }; });
vi.mock('@/lib/features', () => ({ getFeatureFlags: () => ({ localPackager: true }) }));
vi.mock('@/lib/supabase', async () => { const { createClient } = await import('@supabase/supabase-js'); return { createServerClient: () => createClient('https://database.example.test', 'fake-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: state.fetch } }), isSupabaseServerConfigured: state.configured }; });
vi.mock('@/lib/curated-catalog/server', () => ({ validateCuratedPackagingJob: vi.fn(async () => {}) }));
vi.mock('@/lib/curated-catalog/licence', async (original) => ({ ...await original<object>(), assertCuratedLicenceAccepted: vi.fn(async () => {}) }));
vi.mock('@/lib/winget-dependencies', () => ({ resolveWingetPackageDependencies: state.dependencies }));
vi.mock('@/lib/qa/gate', async (original) => { const gate = await original<typeof import('@/lib/qa/gate')>(); state.actualGate = gate.enforceQaGate; return { ...gate, enforceQaGate: state.gate }; });
import { POST } from './route';
import { QaGateNotPassedError } from '@/lib/qa/gate';
const request = () => new NextRequest('http://localhost/api/packager/jobs', { method: 'POST', headers: { Authorization: 'Bearer fake', 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: 'job', packagerId: 'worker' }) });
describe('local worker reputation boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks(); state.dependencies.mockResolvedValue([]); state.realAdapter = false; state.configured.mockReturnValue(true);
    state.claim.mockResolvedValue({ id: 'job', status: 'packaging', packaging_started_at: '2026-10-16T18:00:00Z', winget_id: 'Test.App', version: '1', architecture: 'x64', installer_sha256: 'A'.repeat(64), package_config: { sourceType: 'winget' } });
    state.update.mockResolvedValue({ id: 'job', status: 'awaiting_qa' });
  });
  it.each(['unknown', 'read error'])('never returns installer material to the worker on %s', async (kind) => {
    state.gate.mockRejectedValue(kind === 'unknown' ? new QaGateNotPassedError({ wingetId: 'Test.App', version: '1', architecture: 'x64', installerSha256: 'A'.repeat(64), packageProfileSha256: '', reason: 'reputation' }) : new Error('database unavailable'));
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(409); expect(body.claimed).toBe(false); expect(body).not.toHaveProperty('job');
    expect(state.update).toHaveBeenCalledWith('job', expect.objectContaining({ status: 'awaiting_qa', packager_id: null, completed_at: null }), { status: 'packaging', packaging_started_at: '2026-10-16T18:00:00Z' });
  });
  it('hands a job to the worker after a clean gate verdict', async () => {
    const response = await POST(request()); expect((await response.json()).claimed).toBe(true);
    expect(state.gate).toHaveBeenCalledWith(expect.objectContaining({ wingetId: 'Test.App', installerSha256: 'A'.repeat(64) }));
  });
  it('returns a real Supabase claim without packager_id to awaiting QA', async () => {
    state.realAdapter = true;
    state.row = { ...(await state.claim()), status: 'queued', packager_id: null };
    state.gate.mockRejectedValue(new Error('no verdict available'));
    state.fetch.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const matches = [...url.searchParams].every(([key, value]) => key === 'select'
        || (value.startsWith('eq.') && String(state.row[key]) === value.slice(3))
        || (value === 'is.null' && state.row[key] == null));
      if (!matches) return new Response(JSON.stringify({ code: 'PGRST116', message: 'No matching row' }), { status: 406, headers: { 'content-type': 'application/json' } });
      Object.assign(state.row, JSON.parse(init.body));
      return new Response(JSON.stringify(state.row), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const response = await POST(request());
    expect(response.status).toBe(409); expect((await response.json()).claimed).toBe(false);
    expect(state.fetch).toHaveBeenCalledTimes(2);
    expect(state.row).toMatchObject({ status: 'awaiting_qa', packager_id: null, completed_at: null });
  });
  it('reports an unsuccessful hold transition without returning installer material', async () => {
    state.gate.mockRejectedValue(new Error('unavailable')); state.update.mockResolvedValue(null);
    const response = await POST(request()); expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty('job');
  });
  it.each(['unknown', 'override', 'read error', 'no engines', 'fractional engines', 'suspicious', 'clean', 'dependency missing', 'dependency stale', 'dependency covered'])(
    'runs the real gate and Supabase adapter before local handoff: %s', async (kind) => {
      state.realAdapter = true;
      state.row = { ...(await state.claim()), status: 'queued', packager_id: null,
        package_config: { sourceType: 'winget', qaOverride: kind === 'override' } };
      state.gate.mockImplementation(input => state.actualGate!(input));
      const dependency = kind.startsWith('dependency ');
      const admitted = kind === 'clean' || kind === 'dependency covered';
      if (dependency) state.dependencies.mockResolvedValue([{ installerSha256: 'D'.repeat(64) }]);
      const verdict = { virustotal_status: kind === 'unknown' || kind === 'override' ? 'not_found' : 'clean',
        virustotal_malicious: 0, virustotal_suspicious: kind === 'suspicious' ? 1 : 0,
        virustotal_total_engines: kind === 'no engines' ? 0 : kind === 'fractional engines' ? 0.5 : 72 };
      state.fetch.mockImplementation(async (input, init) => {
        const url = new URL(String(input)); let result: unknown;
        if (url.pathname.endsWith('/qa_installer_security_holds')) result = [];
        else if (url.pathname.endsWith('/catalog_file_reputation')) {
          expect(url.searchParams.get('sha256')).toBe('in.(' + 'd'.repeat(64) + ')');
          const now = Date.now();
          result = kind === 'dependency missing' ? [] : [{
            sha256: 'd'.repeat(64), status: 'found', malicious: 0, suspicious: 0,
            total_engines: 70, engine_count_version: 2,
            checked_at: new Date(now - (kind === 'dependency stale' ? 8 : 1) * 86400000).toISOString(),
            analyzed_at: new Date(now - 86400000).toISOString(),
            retry_after: new Date(now + 86400000).toISOString(),
          }];
        } else if (url.pathname.endsWith('/qa_package_blocks')) result = null;
        else if (url.pathname.endsWith('/qa_package_results')) {
          expect(url.searchParams.get('installer_sha256')).toBe('eq.' + 'A'.repeat(64));
          if (url.searchParams.has('virustotal_malicious')) result = null;
          else if (url.searchParams.get('select')?.includes('virustotal_status')) {
            if (kind === 'read error') return new Response(JSON.stringify({ message: 'synthetic unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
            result = verdict;
          } else result = { winget_id: 'Test.App', tested_version: '1', architecture: 'x64', installer_sha256: 'A'.repeat(64), outcome: 'Passed' };
        } else if (url.pathname.endsWith('/packaging_jobs')) {
          const matches = [...url.searchParams].every(([key, value]) => key === 'select'
            || (value.startsWith('eq.') && String(state.row[key]) === value.slice(3))
            || (value === 'is.null' && state.row[key] == null));
          if (!matches) return new Response(JSON.stringify({ code: 'PGRST116', message: 'No matching row' }), { status: 406, headers: { 'content-type': 'application/json' } });
          Object.assign(state.row, JSON.parse(init.body)); result = state.row;
        } else throw new Error('Unexpected fixture request');
        return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
      });
      const response = await POST(request()); const body = await response.json();
      expect(body.claimed).toBe(admitted);
      if (dependency) expect(state.dependencies).toHaveBeenCalledWith(expect.objectContaining({
        wingetId: 'Test.App', version: '1', architecture: 'x64', installerSha256: 'A'.repeat(64),
      }));
      expect(state.row.status).toBe(admitted ? 'packaging' : 'awaiting_qa');
      if (!admitted) {
        expect(body).not.toHaveProperty('job');
        const second = await POST(request());
        expect((await second.json()).claimed).toBe(false);
        expect(state.row.status).toBe('awaiting_qa');
        expect(state.gate).toHaveBeenCalledTimes(1);
      }
    }
  );
  it('preserves standalone installations without a QA backend', async () => {
    state.configured.mockReturnValue(false); state.gate.mockRejectedValue(new Error('no backend'));
    expect((await (await POST(request())).json()).claimed).toBe(true); expect(state.gate).not.toHaveBeenCalled();
  });

  it.each(['newer unknown', 'newer suspicious', 'newer suspicious older scan', 'newer clean', 'historical malicious'])(
    'uses current exact-payload evidence before local handoff: %s', async (kind) => {
      state.realAdapter = true;
      state.row = { ...(await state.claim()), status: 'queued', packager_id: null };
      state.gate.mockImplementation(input => state.actualGate!(input));
      const clean = {
        winget_id: 'Test.App', tested_version: '1', architecture: 'x64', installer_sha256: 'A'.repeat(64),
        outcome: 'Passed', virustotal_status: 'clean', virustotal_malicious: 0,
        virustotal_suspicious: 0, virustotal_total_engines: 72,
      };
      const rows = [
        { ...clean, package_profile_sha256: 'B'.repeat(64), tested_at_utc: '2026-10-16T10:00:00Z',
          virustotal_scanned_at_utc: '2026-10-16T10:02:00Z',
          ...(kind === 'historical malicious' ? { virustotal_status: 'malicious', virustotal_malicious: 2 }
            : kind === 'newer clean' ? { virustotal_status: 'suspicious', virustotal_suspicious: 1 } : {}) },
        { ...clean, package_profile_sha256: 'C'.repeat(64), tested_at_utc: '2026-10-16T11:00:00Z',
          virustotal_scanned_at_utc: kind === 'newer suspicious older scan' ? '2026-10-16T09:00:00Z'
            : kind === 'newer clean' ? '2026-10-16T11:02:00Z' : null,
          ...(kind.startsWith('newer suspicious') ? { virustotal_status: 'suspicious', virustotal_suspicious: 1 }
            : kind === 'newer unknown' ? { virustotal_status: 'not_found', virustotal_total_engines: 0 } : {}) },
      ];
      state.fetch.mockImplementation(async (input, init) => {
        const url = new URL(String(input)); let result: unknown;
        if (url.pathname.endsWith('/qa_package_blocks')) result = null;
        else if (url.pathname.endsWith('/qa_package_results')) {
          // Apply the real client's serialized filters and ordering to two
          // independent lifecycle profiles for the same installer bytes.
          const matches = rows.filter(row => [...url.searchParams].every(([key, value]) => {
            if (key === 'select' || key === 'order' || key === 'limit') return true;
            const actual = row[key as keyof typeof row];
            if (value.startsWith('eq.')) return String(actual) === value.slice(3);
            if (value.startsWith('gte.')) return Number(actual) >= Number(value.slice(4));
            throw new Error('Unexpected fixture filter');
          }));
          const order = (url.searchParams.get('order') || '').split(',').filter(Boolean);
          matches.sort((a, b) => {
            for (const clause of order) {
              const [column, direction, nulls] = clause.split('.');
              const left = a[column as keyof typeof a], right = b[column as keyof typeof b];
              if (left === right) continue;
              if (left == null) return nulls === 'nullslast' ? 1 : -1;
              if (right == null) return nulls === 'nullslast' ? -1 : 1;
              const comparison = String(left).localeCompare(String(right));
              if (comparison) return direction === 'desc' ? -comparison : comparison;
            }
            return 0;
          });
          result = matches[0] || null;
        } else if (url.pathname.endsWith('/packaging_jobs')) {
          const matches = [...url.searchParams].every(([key, value]) => key === 'select'
            || (value.startsWith('eq.') && String(state.row[key]) === value.slice(3))
            || (value === 'is.null' && state.row[key] == null));
          if (!matches) return new Response(JSON.stringify({ code: 'PGRST116', message: 'No matching row' }),
            { status: 406, headers: { 'content-type': 'application/json' } });
          Object.assign(state.row, JSON.parse(init.body)); result = state.row;
        } else throw new Error('Unexpected fixture request');
        return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
      });
      const response = await POST(request()); const body = await response.json();
      expect(body.claimed).toBe(kind === 'newer clean');
      expect(state.row.status).toBe(kind === 'newer clean' ? 'packaging' : 'awaiting_qa');
      if (kind !== 'newer clean') expect(body).not.toHaveProperty('job');
    }
  );
});
