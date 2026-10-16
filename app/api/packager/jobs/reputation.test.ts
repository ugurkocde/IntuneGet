import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ claim: vi.fn(), update: vi.fn(), gate: vi.fn(), configured: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({ jobs: { claim: state.claim, update: state.update } }), verifyPackagerApiKey: () => true }));
vi.mock('@/lib/features', () => ({ getFeatureFlags: () => ({ localPackager: true }) }));
vi.mock('@/lib/supabase', () => ({ createServerClient: vi.fn(), isSupabaseServerConfigured: state.configured }));
vi.mock('@/lib/curated-catalog/server', () => ({ validateCuratedPackagingJob: vi.fn(async () => {}) }));
vi.mock('@/lib/curated-catalog/licence', async (original) => ({ ...await original<object>(), assertCuratedLicenceAccepted: vi.fn(async () => {}) }));
vi.mock('@/lib/qa/gate', async (original) => ({ ...await original<object>(), enforceQaGate: state.gate }));
import { POST } from './route';
import { QaGateNotPassedError } from '@/lib/qa/gate';
const request = () => new NextRequest('http://localhost/api/packager/jobs', { method: 'POST', headers: { Authorization: 'Bearer fake', 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: 'job', packagerId: 'worker' }) });
describe('local worker reputation boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks(); state.configured.mockReturnValue(true);
    state.claim.mockResolvedValue({ id: 'job', status: 'packaging', winget_id: 'Test.App', version: '1', architecture: 'x64', installer_sha256: 'A'.repeat(64), package_config: { sourceType: 'winget' } });
    state.update.mockResolvedValue({ id: 'job', status: 'awaiting_qa' });
  });
  it.each(['unknown', 'read error'])('never returns installer material to the worker on %s', async (kind) => {
    state.gate.mockRejectedValue(kind === 'unknown' ? new QaGateNotPassedError({ wingetId: 'Test.App', version: '1', architecture: 'x64', installerSha256: 'A'.repeat(64), packageProfileSha256: '', reason: 'reputation' }) : new Error('database unavailable'));
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(409); expect(body.claimed).toBe(false); expect(body).not.toHaveProperty('job');
    expect(state.update).toHaveBeenCalledWith('job', expect.objectContaining({ status: 'awaiting_qa', packager_id: null, completed_at: null }), { status: 'packaging', packager_id: 'worker' });
  });
  it('hands a job to the worker after a clean gate verdict', async () => {
    const response = await POST(request()); expect((await response.json()).claimed).toBe(true);
    expect(state.gate).toHaveBeenCalledWith(expect.objectContaining({ wingetId: 'Test.App', installerSha256: 'A'.repeat(64) }));
  });
  it('preserves standalone installations without a QA backend', async () => {
    state.configured.mockReturnValue(false); state.gate.mockRejectedValue(new Error('no backend'));
    expect((await (await POST(request())).json()).claimed).toBe(true); expect(state.gate).not.toHaveBeenCalled();
  });
});
