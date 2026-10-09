import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { cleanupCuratedLiveSessions } from './live-session-cleanup';
const id = '11111111-1111-4111-8111-111111111111';
function client() {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [{ id }], error: null }), delete: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(),
    then: (resolve: (value: object) => unknown) => Promise.resolve({ error: null }).then(resolve) };
  const bucket = { list: vi.fn().mockResolvedValueOnce({ data: [{ name: 'frame-1.jpg' }], error: null }).mockResolvedValue({ data: [], error: null }), remove: vi.fn().mockResolvedValue({ error: null }) };
  const db = { rpc: vi.fn().mockResolvedValue({ error: null }), from: vi.fn(() => query), storage: { from: vi.fn(() => bucket) } };
  return { db: db as unknown as SupabaseClient, query, bucket, raw: db };
}
beforeEach(() => { vi.stubEnv('QA_LIVE_CURATED_HMAC_KEY', Buffer.alloc(32, 1).toString('base64')); });
describe('ended curated telemetry cleanup', () => {
  it('uses the existing cleanup schedule to expire telemetry and remove only ended-session objects', async () => {
    const { db, raw, query, bucket } = client();
    expect(await cleanupCuratedLiveSessions(db)).toEqual({ cleanedSessions: 1, skippedSessions: 0, removedObjects: 1 });
    expect(raw.rpc).toHaveBeenCalledWith('expire_qa_live_curated_sessions');
    expect(query.eq).toHaveBeenCalledWith('state', 'ended');
    expect(bucket.remove).toHaveBeenCalledWith([`sessions/${id}/frame-1.jpg`]);
    expect(query.update).toHaveBeenCalledWith({ frames_cleaned_at: expect.any(String) });
  });
  it('keeps failed and partially cleaned storage retryable', async () => {
    const { db, query, bucket } = client();
    bucket.remove.mockResolvedValue({ error: new Error('storage down') });
    expect(await cleanupCuratedLiveSessions(db)).toMatchObject({ cleanedSessions: 0, skippedSessions: 1 });
    expect(query.update).not.toHaveBeenCalled();
  });
  it('stays inert before rollout and does not query an absent migration', async () => {
    vi.stubEnv('QA_LIVE_CURATED_HMAC_KEY', '');
    const { db, raw } = client();
    expect(await cleanupCuratedLiveSessions(db)).toMatchObject({ cleanedSessions: 0 });
    expect(raw.rpc).not.toHaveBeenCalled();
  });
});
