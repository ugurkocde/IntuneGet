import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ job: {} as Record<string, unknown>, update: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({ jobs: { getById: async () => state.job, update: state.update } }) }));
vi.mock('@/lib/msp/batch-orchestrator', () => ({ onJobCompleted: vi.fn() }));
vi.mock('@/lib/auto-update/cleanup', () => ({ handleAutoUpdateJobCompletion: vi.fn() }));
vi.mock('@/lib/update-policies/ensure-policy', () => ({ ensureUpdatePolicy: vi.fn(), parseCartUpdatePolicy: () => null }));
vi.mock('@/lib/installer-preflight', () => ({ quarantineInstaller: vi.fn() }));
import { POST } from './route';

const jobId = '4a4f09e2-cc56-4ad2-a264-38b8f91e79c7';
const send = (runId: string | undefined) => {
  const body = JSON.stringify({ jobId, status: 'packaging', runId });
  const signature = createHmac('sha256', 'fixture-secret').update(body).digest('base64');
  return POST(new NextRequest('http://localhost/api/package/callback', { method: 'POST', body, headers: { 'X-Signature': signature } }));
};

describe('retired customer run callback fences', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv('CALLBACK_SECRET', 'fixture-secret');
    state.job = { id: jobId, status: 'packaging', updated_at: '2026-11-10T10:00:00Z', infrastructure_retry_run_id: '42' };
    state.update.mockReset().mockImplementation(async (_id, patch) => ({ ...state.job, ...patch }));
  });
  it('ignores a late callback while fresh QA admission is pending', async () => {
    state.job.status = 'awaiting_qa';
    state.job.infrastructure_retry_run_id = null;
    expect(await (await send('43')).json()).toMatchObject({ ignored: true });
    expect(state.update).not.toHaveBeenCalled();
  });
  it('ignores the retired run even after the replacement is packaging', async () => {
    expect(await (await send('42')).json()).toMatchObject({ ignored: true });
    expect(state.update).not.toHaveBeenCalled();
  });
  it('ignores unidentified callbacks after a run has been retired', async () => {
    expect(await (await send(undefined)).json()).toMatchObject({ ignored: true });
    expect(state.update).not.toHaveBeenCalled();
  });
  it('allows a different authenticated run and guards the observed row revision', async () => {
    expect((await send('43')).status).toBe(200);
    expect(state.update).toHaveBeenCalledWith(jobId, expect.objectContaining({ github_run_id: '43' }),
      { status: 'packaging', updated_at: '2026-11-10T10:00:00Z' });
  });
  it('preserves legitimate callback correction of a historical guessed run ID', async () => {
    state.job.infrastructure_retry_run_id = null;
    state.job.github_run_id = '41';
    expect((await send('43')).status).toBe(200);
    expect(state.update).toHaveBeenCalled();
  });
});
