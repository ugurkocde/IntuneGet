import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ client: vi.fn(), snapshot: vi.fn(), strictLimit: vi.fn(), limit: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ createServerClient: mocks.client }));
vi.mock('@/lib/qa/live-session-data', () => ({ loadQaLiveCuratedSnapshot: mocks.snapshot }));
vi.mock('@/lib/rate-limit', () => ({ applyStrictRateLimit: mocks.strictLimit, applyRateLimit: mocks.limit, getIpKey: () => 'test', QA_LIVE_INGEST_RATE_LIMIT: {}, QA_LIVE_FRAME_RATE_LIMIT: {} }));
import { POST as sessionPost } from '@/app/api/qa/live/session/route';
import { GET as frameGet, POST as framePost } from '@/app/api/qa/live/session/frame/route';
import { signQaLiveSessionMessage, type QaLiveSignatureBinding } from './live-session-signature';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';

const key = Buffer.alloc(32, 42);
const id = '11111111-1111-4111-8111-111111111111';
const app = CURATED_APPS[0];
const jpeg = Uint8Array.from([255,216,255,217]);
function signed(path: QaLiveSignatureBinding['pathname'], data: Record<string, unknown>, action: QaLiveSignatureBinding['action']) {
  const body = JSON.stringify(data);
  const binding: QaLiveSignatureBinding = { method: 'POST', pathname: path, action, runId: String(data.runId), runAttempt: Number(data.runAttempt), sessionId: action === 'begin' ? null : String(data.sessionId) };
  const ts = Math.floor(Date.now() / 1000);
  const sig = signQaLiveSessionMessage(key, binding, ts, Buffer.from(body));
  return new Request(`https://www.intuneget.com${path}`, { method: 'POST', body,
    headers: { 'Content-Type': 'application/json', Authorization: `IntuneQA-HMAC-SHA256 kid=curated-v1,ts=${ts},sig=${sig}` } });
}
const begin = { action: 'begin', runId: '123', runAttempt: 1, appId: app.id, version: '1.0', architecture: app.architecture, upgradePlanned: false, hostCustomConfig: false };
function snapshot(privateRun = false) {
  const now = new Date().toISOString();
  return { binding: { id, app_id: app.id, version: '1.0', kind: privateRun ? 'config' : 'release', status: 'dispatched', inputs: {}, dispatched_at: now, github_run_id: '123' },
    session: { id, queue_id: id, app_id: app.id, version: '1.0', architecture: app.architecture, verification: 'release', public_frames: true,
      upgrade_planned: false, github_run_id: 123, state: 'active', phase: 'installing', phase_started_at: now, started_at: now, heartbeat_at: now },
    frame: { session_id: id, sequence: 1, captured_at: now, updated_at: now, width: 640, height: 480 } };
}
function dbStub() {
  const row = { object_path: `sessions/${id}/frame-1.jpg`, sequence: 1, byte_size: 4 };
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
  const storage = { download: vi.fn().mockResolvedValue({ data: new Blob([jpeg]), error: null }), upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }) };
  return { rpc: vi.fn(), from: vi.fn(() => query), storage: { from: vi.fn(() => storage) }, query, bucket: storage };
}
beforeEach(() => {
  vi.resetAllMocks();
  process.env.QA_LIVE_CURATED_HMAC_KEY = key.toString('base64');
  delete process.env.QA_LIVE_CURATED_HMAC_KEY_PREVIOUS;
  delete process.env.QA_MAINTENANCE_MODE;
  mocks.strictLimit.mockResolvedValue(null); mocks.limit.mockResolvedValue(null);
});
describe('curated live session routes', () => {
  it('stays inert without its own key, even if the ordinary secret is set', async () => {
    delete process.env.QA_LIVE_CURATED_HMAC_KEY;
    process.env.QA_SYNC_SECRET = 'ordinary-secret';
    expect((await sessionPost(signed('/api/qa/live/session', begin, 'begin'))).status).toBe(404);
    expect(mocks.client).not.toHaveBeenCalled();
    delete process.env.QA_SYNC_SECRET;
  });
  it('refuses unsigned, altered, query-bearing and unknown-field requests before DB access', async () => {
    const valid = signed('/api/qa/live/session', begin, 'begin');
    const signature = valid.headers;
    for (const request of [new Request(valid.url, { method: 'POST', body: JSON.stringify(begin), headers: { 'Content-Type': 'application/json' } }),
      new Request(valid.url, { method: 'POST', body: JSON.stringify({ ...begin, version: '2.0' }), headers: signature }),
      new Request(valid.url + '?tenant=private', { method: 'POST', body: JSON.stringify(begin), headers: signature }),
      signed('/api/qa/live/session', { ...begin, tenant: 'private' }, 'begin')]) {
      expect([400, 401]).toContain((await sessionPost(request)).status);
    }
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('binds the exact run tuple and returns only safe session fields', async () => {
    const db = dbStub();
    db.rpc.mockResolvedValue({ data: { status: 'started', sessionId: id, publicFrames: false, endedSessionIds: [], inputs: { tenant: 'private' } }, error: null });
    mocks.client.mockReturnValue(db);
    const response = await sessionPost(signed('/api/qa/live/session', begin, 'begin'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'started', sessionId: id, publicFrames: false });
    expect(db.rpc).toHaveBeenCalledWith('begin_qa_live_curated_session', expect.objectContaining({ p_run_id: '123', p_run_attempt: 1, p_host_custom_config: false }));
  });
  it('still reports a started session when cleanup of a retired session fails', async () => {
    const db = dbStub(); mocks.client.mockReturnValue(db);
    db.rpc.mockResolvedValue({ data: { status: 'started', sessionId: id, publicFrames: true, endedSessionIds: ['22222222-2222-4222-8222-222222222222'] }, error: null });
    Object.assign(db.bucket, { list: vi.fn().mockRejectedValue(new Error('storage down')) });
    const response = await sessionPost(signed('/api/qa/live/session', begin, 'begin'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'started', sessionId: id, publicFrames: true });
  });
  it('does not turn a DB refusal into a fake current session', async () => {
    const db = dbStub(); db.rpc.mockResolvedValue({ data: { status: 'refused' }, error: null }); mocks.client.mockReturnValue(db);
    expect((await sessionPost(signed('/api/qa/live/session', begin, 'begin'))).status).toBe(409);
  });
});
describe('curated live frame routes', () => {
  const get = () => new Request(`https://www.intuneget.com/api/qa/live/session/frame?session=${id}&sequence=1`);
  it('never reads Storage for a config run even if session publicity was forged', async () => {
    const db = dbStub(); mocks.client.mockReturnValue(db); mocks.snapshot.mockResolvedValue(snapshot(true));
    expect((await frameGet(get())).status).toBe(404);
    expect(db.bucket.download).not.toHaveBeenCalled();
  });
  it('serves a fresh release JPEG through a no-store response', async () => {
    const db = dbStub(); mocks.client.mockReturnValue(db); const state = snapshot(); mocks.snapshot.mockResolvedValue(state);
    const response = await frameGet(get());
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg);
  });
  it('re-checks privacy after storage download rather than leaking a frame from a changed owner', async () => {
    const db = dbStub(); mocks.client.mockReturnValue(db);
    mocks.snapshot.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot(true));
    expect((await frameGet(get())).status).toBe(404);
    expect(db.bucket.download).toHaveBeenCalledTimes(1);
  });
  it('rejects a stale heartbeat and session mismatches without downloading', async () => {
    const db = dbStub(); mocks.client.mockReturnValue(db);
    const state = snapshot(); state.session.heartbeat_at = new Date(Date.now() - 180000).toISOString();
    state.session.started_at = new Date(Date.now() - 200000).toISOString();
    mocks.snapshot.mockResolvedValue(state);
    expect((await frameGet(get())).status).toBe(404); expect(db.bucket.download).not.toHaveBeenCalled();
  });
  it('requires fresh authoritative frame authorization before any upload', async () => {
    const db = dbStub(); mocks.client.mockReturnValue(db); db.rpc.mockResolvedValue({ data: false, error: null });
    const data = { runId: '123', runAttempt: 1, sessionId: id, sequence: 2, capturedAt: new Date().toISOString(), width: 640, height: 480, jpegBase64: Buffer.from(jpeg).toString('base64') };
    expect((await framePost(signed('/api/qa/live/session/frame', data, 'frame'))).status).toBe(401);
    expect(db.bucket.upload).not.toHaveBeenCalled();
  });
  it('uses immutable uploads and deletes an orphan when publication loses its owner', async () => {
    const db = dbStub(); mocks.client.mockReturnValue(db);
    db.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    const data = { runId: '123', runAttempt: 1, sessionId: id, sequence: 2, capturedAt: new Date().toISOString(), width: 640, height: 480, jpegBase64: Buffer.from(jpeg).toString('base64') };
    expect((await framePost(signed('/api/qa/live/session/frame', data, 'frame'))).status).toBe(409);
    expect(db.bucket.upload).toHaveBeenCalledWith(`sessions/${id}/frame-2.jpg`, expect.any(Buffer), expect.objectContaining({ upsert: false }));
    expect(db.bucket.remove).toHaveBeenCalledWith([`sessions/${id}/frame-2.jpg`]);
  });
});
