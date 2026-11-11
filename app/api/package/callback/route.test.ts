import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ job: {} as Record<string, unknown>, update: vi.fn(), get: vi.fn(), history: vi.fn(), completed: vi.fn(), cleanup: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({ jobs: { getById: state.get, update: state.update }, uploadHistory: { create: state.history } }) }));
vi.mock('@/lib/msp/batch-orchestrator', () => ({ onJobCompleted: state.completed }));
vi.mock('@/lib/auto-update/cleanup', () => ({ handleAutoUpdateJobCompletion: state.cleanup }));
vi.mock('@/lib/update-policies/ensure-policy', () => ({ ensureUpdatePolicy: vi.fn(), parseCartUpdatePolicy: () => null }));
vi.mock('@/lib/installer-preflight', () => ({ quarantineInstaller: vi.fn() }));
import { POST } from './route';

const jobId = '4a4f09e2-cc56-4ad2-a264-38b8f91e79c7';
const send = (runId: string | undefined, attemptId?: string, status = 'packaging', extra: Record<string, unknown> = {}) => {
  const body = JSON.stringify({ jobId, status, runId, attemptId, ...extra });
  const signature = createHmac('sha256', 'fixture-secret').update(body).digest('base64');
  return POST(new NextRequest('http://localhost/api/package/callback', { method: 'POST', body, headers: { 'X-Signature': signature } }));
};

describe('retired customer run callback fences', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv('CALLBACK_SECRET', 'fixture-secret');
    state.job = { id: jobId, status: 'packaging', updated_at: '2026-11-10T10:00:00Z', github_run_id: '43', callback_run_id: '43', infrastructure_retry_run_id: '42' };
    state.get.mockReset().mockImplementation(async () => state.job);
    state.history.mockReset().mockResolvedValue({});
    state.completed.mockReset().mockResolvedValue(undefined);
    state.cleanup.mockReset().mockResolvedValue(undefined);
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
  it('applies replacement upload progress whose identity is carried only by attemptId', async () => {
    expect((await send(undefined, '43-1', 'uploading')).status).toBe(200);
    expect(state.update).toHaveBeenCalledWith(jobId, expect.objectContaining({ status: 'uploading' }),
      { status: 'packaging', updated_at: '2026-11-10T10:00:00Z', callback_run_id: '43' });
  });
  it('rejects a retired attempt without an explicit runId', async () => {
    expect(await (await send(undefined, '42-1', 'uploading')).json()).toMatchObject({ ignored: true });
    expect(state.update).not.toHaveBeenCalled();
  });
  it('rejects contradictory explicit and attempt identities', async () => {
    expect(await (await send('43', '42-1')).json()).toMatchObject({ ignored: true });
    expect(state.update).not.toHaveBeenCalled();
  });
  it('rejects malformed or unsafe attempt identities after retirement', async () => {
    for (const attempt of ['43-0', '43-1-extra', '9007199254740993-1']) {
      expect(await (await send(undefined, attempt)).json()).toMatchObject({ ignored: true });
    }
    expect(state.update).not.toHaveBeenCalled();
  });
  it('allows a different authenticated run and guards the observed row revision', async () => {
    expect((await send('43')).status).toBe(200);
    expect(state.update).toHaveBeenCalledWith(jobId, expect.objectContaining({ github_run_id: '43' }),
      { status: 'packaging', updated_at: '2026-11-10T10:00:00Z', callback_run_id: '43' });
  });
  it('preserves legitimate callback correction of a historical guessed run ID', async () => {
    state.job.infrastructure_retry_run_id = null;
    state.job.github_run_id = '41';
    expect((await send('43')).status).toBe(200);
    expect(state.update).toHaveBeenCalled();
  });
  it('claims an authenticated callback separately from a historical captured run', async () => {
    state.job.infrastructure_retry_run_id = null;
    state.job.github_run_id = '41';
    state.job.callback_run_id = null;
    expect((await send('43', '43-1')).status).toBe(200);
    expect(state.update).toHaveBeenCalledWith(jobId,
      expect.objectContaining({ github_run_id: '43', callback_run_id: '43' }),
      expect.objectContaining({ callback_run_id: null }));
  });
  it.each(['packaging', 'deployed'])('refuses a foreign callback owner before stale or %s status checks', async status => {
    state.job.callback_run_id = '43';
    state.job.status = status;
    expect(await (await send('44', '44-1', 'packaging', {
      heartbeatAt: '2026-11-10T09:59:59Z',
    })).json()).toMatchObject({ success: false, reason: 'run_not_owner' });
    expect(state.update).not.toHaveBeenCalled();
    expect(state.history).not.toHaveBeenCalled();
  });
  it('refuses a first-claim CAS loser instead of returning an active winner as success', async () => {
    state.job.github_run_id = '41';
    state.job.callback_run_id = null;
    const winner = { ...state.job, github_run_id: '43', callback_run_id: '43', updated_at: '2026-11-10T10:00:01Z' };
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce(winner);
    state.update.mockResolvedValueOnce(null);
    expect(await (await send('44', '44-1')).json()).toMatchObject({
      success: false, reason: 'run_not_owner',
    });
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.history).not.toHaveBeenCalled();
    expect(state.completed).not.toHaveBeenCalled();
    expect(state.cleanup).not.toHaveBeenCalled();
  });
  it('accepts a new attempt from the same authenticated callback owner', async () => {
    state.job.callback_run_id = '43';
    expect(await (await send('43', '43-2')).json()).toMatchObject({ success: true });
    expect(state.update).toHaveBeenCalled();
  });
  it('never acknowledges a retired runner with the active replacement job', async () => {
    state.job.callback_run_id = '43';
    expect(await (await send('42', '42-1')).json()).toMatchObject({ success: false });
    expect(state.update).not.toHaveBeenCalled();
  });
  it('does not acknowledge an unowned stale heartbeat as an active claim', async () => {
    state.job.callback_run_id = null;
    expect(await (await send('43', '43-1', 'packaging', {
      heartbeatAt: '2026-11-10T09:59:59Z',
    })).json()).toMatchObject({ success: false, reason: 'ownership_unconfirmed' });
    expect(state.update).not.toHaveBeenCalled();
  });
  it.each([[undefined, undefined], ['43', '44-1'], ['0', undefined]])('rejects an unowned callback with invalid identity %s/%s', async (run, attempt) => {
    state.job.callback_run_id = null;
    state.job.infrastructure_retry_run_id = null;
    expect(await (await send(run, attempt)).json()).toMatchObject({ success: false, reason: 'run_identity_missing' });
    expect(state.update).not.toHaveBeenCalled();
  });
  it('retries an unowned claim once after a dispatcher capture write', async () => {
    state.job.callback_run_id = null;
    const fresh = { ...state.job, github_run_id: '41', updated_at: '2026-11-10T10:00:01Z' };
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce(fresh);
    state.update.mockResolvedValueOnce(null).mockImplementationOnce(async (_id, patch) => ({ ...fresh, ...patch }));
    expect(await (await send('43', '43-1')).json()).toMatchObject({ success: true, job: { callback_run_id: '43', github_run_id: '43' } });
    expect(state.update).toHaveBeenLastCalledWith(jobId, expect.objectContaining({ callback_run_id: '43' }), expect.objectContaining({ callback_run_id: null, updated_at: fresh.updated_at }));
  });
  it('refuses a competing claim that wins the second CAS', async () => {
    state.job.callback_run_id = null;
    const fresh = { ...state.job, updated_at: '2026-11-10T10:00:01Z' };
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce(fresh)
      .mockResolvedValueOnce({ ...fresh, callback_run_id: '44' });
    state.update.mockResolvedValue(null);
    expect(await (await send('43', '43-1')).json()).toMatchObject({ success: false, reason: 'run_not_owner' });
    expect(state.update).toHaveBeenCalledTimes(2);
    expect(state.completed).not.toHaveBeenCalled();
  });
  it('acknowledges an ambiguous write only after the same owner is read back', async () => {
    state.job.callback_run_id = null;
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce({ ...state.job, callback_run_id: '43' });
    state.update.mockResolvedValueOnce(null);
    expect(await (await send('43', '43-1')).json()).toMatchObject({ success: true, ignored: true });
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.completed).not.toHaveBeenCalled();
  });
  it.each(['deployed', 'failed', 'duplicate_skipped'])('retries one eligible %s transition against a freshly read revision', async status => {
    const fresh = { ...state.job, updated_at: '2026-11-10T10:00:05Z' };
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce(fresh);
    state.update.mockResolvedValueOnce(null).mockImplementationOnce(async (_id, patch) => ({ ...fresh, ...patch }));
    const response = await send('43', '43-1', status, { heartbeatAt: '2026-11-10T10:00:10Z', intuneAppId: 'fixture-app' });
    expect(await response.json()).toMatchObject({ success: true, job: { status } });
    expect(state.get).toHaveBeenCalledTimes(2);
    expect(state.update).toHaveBeenCalledTimes(2);
    expect(state.update).toHaveBeenLastCalledWith(jobId, expect.objectContaining({ status }),
      { status: fresh.status, updated_at: fresh.updated_at, callback_run_id: fresh.callback_run_id });
    expect(state.completed).toHaveBeenCalledTimes(1);
    expect(state.cleanup).toHaveBeenCalledTimes(1);
    expect(state.history).toHaveBeenCalledTimes(status === 'deployed' ? 1 : 0);
  });
  it.each(['cancelled', 'deployed', 'awaiting_qa'])('does not overwrite a fresh %s state after a lost compare and set', async status => {
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce({ ...state.job, status });
    state.update.mockResolvedValueOnce(null);
    expect(await (await send('43', '43-1', 'deployed')).json()).toMatchObject({ ignored: true });
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.completed).not.toHaveBeenCalled();
    expect(state.history).not.toHaveBeenCalled();
  });
  it('rechecks the retired run fence against the fresh row', async () => {
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce({ ...state.job, infrastructure_retry_run_id: '43' });
    state.update.mockResolvedValueOnce(null);
    expect(await (await send('43', '43-1', 'failed')).json()).toMatchObject({ ignored: true });
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.cleanup).not.toHaveBeenCalled();
  });
  it.each(['deployed', 'failed', 'duplicate_skipped'])('preserves %s after a concurrent same-status write with a later database timestamp', async status => {
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce({ ...state.job, updated_at: '2026-11-10T10:00:11Z' });
    state.update.mockResolvedValueOnce(null).mockImplementationOnce(async (_id, patch) => ({ ...state.job, ...patch }));
    expect(await (await send('43', '43-1', status, { heartbeatAt: '2026-11-10T10:00:10Z', intuneAppId: 'fixture-app' })).json()).toMatchObject({ success: true, job: { status } });
    expect(state.update).toHaveBeenCalledTimes(2);
    expect(state.update).toHaveBeenLastCalledWith(jobId, expect.objectContaining({ status }),
      { status: 'packaging', updated_at: '2026-11-10T10:00:11Z', callback_run_id: '43' });
    expect(state.completed).toHaveBeenCalledTimes(1);
    expect(state.history).toHaveBeenCalledTimes(status === 'deployed' ? 1 : 0);
  });
  it.each([
    { status: 'uploading' },
    { github_run_id: '44' },
    { infrastructure_retry_run_id: '44' },
  ])('does not rescue a terminal callback after execution state changes: %j', async change => {
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce({ ...state.job, ...change, updated_at: '2026-11-10T10:00:11Z' });
    state.update.mockResolvedValueOnce(null);
    expect(await (await send('43', '43-1', 'deployed', { heartbeatAt: '2026-11-10T10:00:10Z' })).json()).toMatchObject({ ignored: true });
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.history).not.toHaveBeenCalled();
    expect(state.completed).not.toHaveBeenCalled();
  });
  it('does not retry a progress callback after a lost compare and set', async () => {
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce({ ...state.job, updated_at: '2026-11-10T10:00:01Z' });
    state.update.mockResolvedValueOnce(null);
    expect(await (await send('43', '43-1', 'uploading')).json()).toMatchObject({ ignored: true });
    expect(state.update).toHaveBeenCalledTimes(1);
  });
  it('stops after a second lost compare and set without terminal side effects', async () => {
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce({ ...state.job, updated_at: '2026-11-10T10:00:01Z' });
    state.update.mockResolvedValue(null);
    expect(await (await send('43', '43-1', 'deployed')).json()).toMatchObject({ ignored: true });
    expect(state.update).toHaveBeenCalledTimes(2);
    expect(state.get).toHaveBeenCalledTimes(3);
    expect(state.history).not.toHaveBeenCalled();
    expect(state.completed).not.toHaveBeenCalled();
  });
  it('does not retry when the fresh row was removed', async () => {
    state.get.mockResolvedValueOnce({ ...state.job }).mockResolvedValueOnce(null);
    state.update.mockResolvedValueOnce(null);
    expect(await (await send('43', '43-1', 'deployed')).json()).toMatchObject({ ignored: true, job: null });
    expect(state.update).toHaveBeenCalledTimes(1);
  });

});
