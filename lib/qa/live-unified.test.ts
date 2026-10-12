import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { buildQaLiveResponse, type QaLiveSnapshotInput } from './live';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
const app = CURATED_APPS[0];
const now = '2026-10-08T18:00:00.000Z';
const id = '11111111-1111-4111-8111-111111111111';
function input(): QaLiveSnapshotInput {
  return { now: new Date(now), current: null, queuedCount: 24, queued: [], poll: null, consecutivePollFailures: 0, recent: [], apps: [], frame: null,
    curated: { binding: { id, app_id: app.id, version: '1.0', kind: 'release', status: 'dispatched', inputs: {}, dispatched_at: '2026-10-08T17:49:59.000Z', github_run_id: '123' },
      session: { id, queue_id: id, app_id: app.id, version: '1.0', architecture: app.architecture, verification: 'release', public_frames: true,
        upgrade_planned: true, github_run_id: 123, state: 'active', phase: 'testing_lifecycle', phase_started_at: now, started_at: '2026-10-08T17:50:00.000Z', heartbeat_at: now },
      frame: { session_id: id, sequence: 2, captured_at: now, updated_at: now, width: 640, height: 480 } } };
}
describe('one live feed for both QA kinds', () => {
  it('shows curated identity while preserving ordinary queue and recent result semantics', () => {
    const response = buildQaLiveResponse(input());
    expect(response.active).toBe(true);
    expect(response.current).toMatchObject({ runKind: 'curated', wingetId: app.packageId, elapsedSeconds: 600, phase: 'testing_lifecycle' });
    expect(response.viewer).toMatchObject({ candidateId: null, sessionId: id, available: true, sequence: 2 });
    expect(response.queue.count).toBe(24); expect(response.recent).toEqual([]);
    expect(response.log).toBeNull(); expect(response.activity).toBeNull();
  });
  it('reports neutral VM occupancy rather than pretending a queued ordinary app has started', () => {
    const data = input(); data.curated!.session = null;
    const response = buildQaLiveResponse(data);
    expect(response.current).toBeNull(); expect(response.active).toBe(false);
    expect(response.vmBusy).toBe('catalog_verification'); expect(response.viewer.available).toBe(false);
  });
  it('keeps ordinary current tests first even if contradictory curated telemetry exists', () => {
    const data = input();
    data.current = { id: '22222222-2222-4222-8222-222222222222', winget_id: 'Example.App', version: '1.0', architecture: 'x64', status: 'running', priority: 10,
      enqueued_at: now, dispatched_at: now, started_at: now, updated_at: now, phase: 'installing', phase_started_at: now } as QaLiveSnapshotInput['current'];
    const response = buildQaLiveResponse(data);
    expect(response.current).toMatchObject({ runKind: 'ordinary', wingetId: 'Example.App' });
    expect(response.viewer.sessionId).toBeUndefined();
  });
  it('redacts custom input and never publishes its frame as release evidence', () => {
    const data = input(); data.curated!.binding!.kind = 'config'; data.curated!.binding!.inputs = { tenant: 'secret-tenant', psadt_config: { secret: 'customer-secret' } };
    const response = buildQaLiveResponse(data);
    expect(response.current).toMatchObject({ runKind: 'curated', verification: 'custom-settings' });
    expect(response.viewer.available).toBe(false);
    expect(JSON.stringify(response)).not.toMatch(/secret-tenant|customer-secret|psadt_config/);
    expect(response.recent).toEqual([]);
  });
});
