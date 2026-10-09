import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('server-only', () => ({}));
const enabled = vi.hoisted(() => vi.fn());
vi.mock('./live-session-auth', () => ({ isQaLiveSessionEnabled: enabled }));
import { loadQaLiveCuratedSnapshot } from './live-session-data';
const binding = { id: 'queue', app_id: 'chrome', version: '1.0', kind: 'release', status: 'dispatched', inputs: {}, dispatched_at: '2026-10-08T18:00:00Z', github_run_id: '123' };
function client(results: unknown[]) {
  const selected: string[] = [];
  const from = vi.fn(() => {
    const value = results.shift();
    const query = { select: (columns: string) => { selected.push(columns); return query; }, eq: () => query,
      limit: () => value instanceof Error ? Promise.reject(value) : Promise.resolve(value),
      maybeSingle: () => value instanceof Error ? Promise.reject(value) : Promise.resolve(value) };
    return query;
  });
  return { db: { from } as unknown as SupabaseClient, from, selected };
}
beforeEach(() => { enabled.mockReturnValue(true); });
describe('optional curated telemetry reads', () => {
  it('preserves neutral occupancy with no HMAC key and does not query new tables', async () => {
    enabled.mockReturnValue(false);
    const db = client([{ data: [binding], error: null }]);
    expect(await loadQaLiveCuratedSnapshot(db.db)).toEqual({ binding, session: null, frame: null });
    expect(db.from).toHaveBeenCalledTimes(1);
  });
  it('survives a missing migration or rejected transport without breaking the ordinary feed', async () => {
    for (const error of [{ data: null, error: { code: '42P01' } }, new Error('transport')]) {
      const db = client([{ data: [binding], error: null }, error]);
      expect(await loadQaLiveCuratedSnapshot(db.db)).toEqual({ binding, session: null, frame: null });
    }
  });
  it('does not read frame metadata for authoritative custom configurations', async () => {
    const custom = { ...binding, kind: 'config' };
    const session = { id: 'session', public_frames: true, verification: 'release' };
    const db = client([{ data: [custom], error: null }, { data: [session], error: null }]);
    expect(await loadQaLiveCuratedSnapshot(db.db)).toEqual({ binding: custom, session, frame: null });
    expect(db.from).toHaveBeenCalledTimes(2);
  });
  it('selects the dispatch identity needed to bind a session to the current dispatch', async () => {
    const db = client([{ data: [binding], error: null }, { data: [], error: null }]);
    await loadQaLiveCuratedSnapshot(db.db);
    expect(db.selected[0].split(', ')).toEqual(expect.arrayContaining(['dispatched_at', 'github_run_id']));
    expect(db.selected[1].split(', ')).toEqual(expect.arrayContaining(['github_run_id', 'started_at']));
  });
  it('does not choose an arbitrary current owner when the queue contradicts itself', async () => {
    const db = client([{ data: [binding, { ...binding, id: 'other' }], error: null }]);
    expect(await loadQaLiveCuratedSnapshot(db.db)).toEqual({ binding: null, session: null, frame: null });
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});
