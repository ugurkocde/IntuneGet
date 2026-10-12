import { describe, expect, it } from 'vitest';
import { projectQaLiveCurated, type QaCuratedLiveBinding, type QaCuratedLiveFrameRow, type QaCuratedLiveSessionRow } from './live-curated';

const now = new Date('2026-10-08T18:00:00Z');
const session: QaCuratedLiveSessionRow = {
  id: '11111111-1111-4111-8111-111111111111', queue_id: '22222222-2222-4222-8222-222222222222',
  app_id: 'chrome', version: '155.0.8059.40', architecture: 'x64', verification: 'release', public_frames: true,
  upgrade_planned: true, github_run_id: 123, state: 'active', phase: 'testing_lifecycle', phase_started_at: '2026-10-08T17:59:00Z',
  started_at: '2026-10-08T17:55:00Z', heartbeat_at: '2026-10-08T17:59:50Z',
};
const binding: QaCuratedLiveBinding = { id: session.queue_id, app_id: session.app_id, version: session.version, kind: 'release', status: 'dispatched', inputs: {}, dispatched_at: '2026-10-08T17:54:59.123456+00:00', github_run_id: '123' };
const frame: QaCuratedLiveFrameRow = { session_id: session.id, sequence: 7, captured_at: '2026-10-08T17:59:56Z', updated_at: '2026-10-08T17:59:57Z', width: 1280, height: 720 };
const project = (overrides: Partial<Parameters<typeof projectQaLiveCurated>[0]> = {}) => projectQaLiveCurated({ now, session, binding, frame, ...overrides });

describe('curated live public projection', () => {
  it('uses only catalogue identity and measured session time', () => {
    expect(project()).toMatchObject({ current: { runKind: 'curated', wingetId: 'IntuneGet.Curated.Chrome', displayName: 'Google Chrome', version: session.version, architecture: 'x64', elapsedSeconds: 300, phase: 'testing_lifecycle' }, viewer: { available: true, sessionId: session.id, candidateId: null } });
    expect(JSON.stringify(project())).not.toMatch(/queue_id|app_id|inputs|tenant|psadt|github_run|object_path|end_reason/);
  });

  it('does not call a completed, mismatched or unknown owner current', () => {
    for (const changed of [{ status: 'completed' }, { id: 'another' }, { app_id: 'firefox' }, { version: 'previous' }]) {
      expect(project({ binding: { ...binding, ...changed } })).toBeNull();
    }
    expect(project({ binding: null })).toBeNull();
    expect(project({ session: { ...session, state: 'ended' } })).toBeNull();
    expect(project({ session: { ...session, app_id: 'unknown' }, binding: { ...binding, app_id: 'unknown' } })).toBeNull();
    expect(project({ session: { ...session, architecture: 'x86' } })).toBeNull();
  });

  it('never publishes custom settings frames, even if session metadata claims public', () => {
    for (const privateBinding of [{ ...binding, kind: 'config' }, { ...binding, inputs: { psadt_config: 'customer text' } }, { ...binding, inputs: { customConfigHash: 'hash' } }, { ...binding, inputs: null }, { ...binding, inputs: [] }]) {
      expect(project({ binding: privateBinding })).toMatchObject({ current: { verification: 'custom-settings' }, viewer: { available: false, capturedAt: null, sequence: null } });
      expect(JSON.stringify(project({ binding: privateBinding }))).not.toContain('customer text');
    }
    expect(project({ session: { ...session, public_frames: false } })?.viewer.available).toBe(false);
  });

  it('marks a stale heartbeat stalled and never serves its frame', () => {
    expect(project({ session: { ...session, heartbeat_at: '2026-10-08T17:57:59Z' } })).toMatchObject({ runner: { state: 'stalled' }, viewer: { available: false } });
  });

  it('rejects frames from another session or time and invalid sequences', () => {
    for (const changed of [{ session_id: binding.id }, { captured_at: '2026-10-08T17:54:59Z' }, { captured_at: '2026-10-08T17:59:40Z', updated_at: '2026-10-08T17:59:44Z' }, { captured_at: '2026-10-08T18:00:06Z', updated_at: '2026-10-08T18:00:00Z' }, { updated_at: 'invalid' }, { sequence: -1 }, { width: 1 }]) {
      expect(project({ frame: { ...frame, ...changed } })?.viewer.available).toBe(false);
    }
  });

  it('binds the session to the current dispatch of the same queue row', () => {
    expect(project({ binding: { ...binding, dispatched_at: '2026-10-08T17:55:00.001+00:00' } })).toBeNull();
    expect(project({ binding: { ...binding, dispatched_at: 'invalid' } })).toBeNull();
    expect(project({ binding: { ...binding, github_run_id: '456' } })).toBeNull();
    expect(project({ binding: { ...binding, dispatched_at: session.started_at } })).not.toBeNull();
    // A dispatch that has not recorded its run id yet still binds by dispatch time.
    expect(project({ binding: { ...binding, github_run_id: null } })?.viewer.available).toBe(true);
    expect(project({ binding: { ...binding, dispatched_at: null, github_run_id: null } })).not.toBeNull();
  });

  it('tolerates small clock skew without refreshing a delayed old capture', () => {
    const early = project({ session: { ...session, started_at: '2026-10-08T18:00:04Z', heartbeat_at: '2026-10-08T18:00:04Z', phase_started_at: '2026-10-08T18:00:04Z' }, frame: null });
    expect(early).toMatchObject({ current: { elapsedSeconds: 0, phaseStartedAt: '2026-10-08T18:00:04Z' } });
    expect(project({ session: { ...session, started_at: '2026-10-08T18:00:06Z', heartbeat_at: '2026-10-08T18:00:06Z' } })).toBeNull();
    // Runner clock ahead of this server by less than the tolerance still shows the frame.
    const ahead = project({ frame: { ...frame, captured_at: '2026-10-08T18:00:03Z', updated_at: '2026-10-08T17:59:59Z' } });
    expect(ahead?.viewer).toMatchObject({ available: true, capturedAt: '2026-10-08T17:59:59Z' });
    // A new upload timestamp cannot make a thirty-second-old capture live.
    expect(project({ frame: { ...frame, captured_at: '2026-10-08T17:59:30Z', updated_at: '2026-10-08T17:59:58Z' } })?.viewer.available).toBe(false);
    expect(project({ frame: { ...frame, captured_at: '2026-10-08T17:59:30Z', updated_at: '2026-10-08T17:59:44Z' } })?.viewer.available).toBe(false);
    expect(project()?.viewer.capturedAt).toBe(frame.updated_at);
  });

  it('expires display evidence without granting any new VM ownership', () => {
    expect(project({ session: { ...session, started_at: '2026-10-08T13:59:59Z' } })).toBeNull();
    expect(project({ session: { ...session, heartbeat_at: 'invalid' } })).toBeNull();
    expect(project({ session: { ...session, phase: 'customer secret' } })?.current.phase).toBeNull();
    expect(session.state).toBe('active');
    expect(binding.status).toBe('dispatched');
  });
});
