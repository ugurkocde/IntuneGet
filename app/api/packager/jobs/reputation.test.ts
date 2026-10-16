import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ claim: vi.fn(), update: vi.fn(), gate: vi.fn(), configured: vi.fn(), realAdapter: false, fetch: vi.fn(), row: {} as Record<string, unknown> }));
vi.mock('@/lib/db', async () => { const { supabaseDb } = await import('@/lib/db/supabase-adapter'); return { getDatabase: () => state.realAdapter ? supabaseDb : ({ jobs: { claim: state.claim, update: state.update } }), verifyPackagerApiKey: () => true }; });
vi.mock('@/lib/features', () => ({ getFeatureFlags: () => ({ localPackager: true }) }));
vi.mock('@/lib/supabase', async () => { const { createClient } = await import('@supabase/supabase-js'); return { createServerClient: () => createClient('https://database.example.test', 'fake-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: state.fetch } }), isSupabaseServerConfigured: state.configured }; });
vi.mock('@/lib/curated-catalog/server', () => ({ validateCuratedPackagingJob: vi.fn(async () => {}) }));
vi.mock('@/lib/curated-catalog/licence', async (original) => ({ ...await original<object>(), assertCuratedLicenceAccepted: vi.fn(async () => {}) }));
vi.mock('@/lib/qa/gate', async (original) => ({ ...await original<object>(), enforceQaGate: state.gate }));
import { POST } from './route';
import { QaGateNotPassedError } from '@/lib/qa/gate';
const request = () => new NextRequest('http://localhost/api/packager/jobs', { method: 'POST', headers: { Authorization: 'Bearer fake', 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: 'job', packagerId: 'worker' }) });
describe('local worker reputation boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks(); state.realAdapter = false; state.configured.mockReturnValue(true);
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
  it('preserves standalone installations without a QA backend', async () => {
    state.configured.mockReturnValue(false); state.gate.mockRejectedValue(new Error('no backend'));
    expect((await (await POST(request())).json()).claimed).toBe(true); expect(state.gate).not.toHaveBeenCalled();
  });
});
