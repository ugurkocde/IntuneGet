import { describe, expect, it } from 'vitest';
import type { QaLiveResponse } from '@/types/qa';
import { qaLiveFrameSrc, qaLiveRefetchInterval, qaLiveViewerKey, selectQaLiveCard } from './live-view';

function fixture(): QaLiveResponse {
  return {
    serverTime: '2026-10-08T18:00:00Z', active: true,
    runner: { state: 'testing', heartbeatAt: '2026-10-08T18:00:00Z' },
    scheduler: { state: 'healthy', lastPollAt: null, lastOutcome: null, issue: null, consecutiveFailures: 0 },
    current: { runKind: 'curated', verification: 'release', wingetId: 'IntuneGet.Curated.Chrome', displayName: 'Chrome', publisher: 'Google', version: '1', catalogVersion: '1', architecture: 'x64', executionContext: 'LocalSystem', phase: 'testing_lifecycle', phaseStartedAt: null, startedAt: '2026-10-08T17:59:00Z', elapsedSeconds: 60, upgradePlanned: false },
    viewer: { sessionId: '11111111-1111-4111-8111-111111111111', candidateId: null, available: true, capturedAt: '2026-10-08T18:00:00Z', sequence: 3, width: 1280, height: 720 },
    queue: { count: 1, next: [{ wingetId: 'Example', displayName: 'Example', version: '1', architecture: 'x64', enqueuedAt: '2026-10-08T17:00:00Z' }] }, recent: [], activity: null, log: null,
  };
}

describe('live feed owner switching', () => {
  it('selects the curated session ahead of the next queued ordinary app', () => {
    const data = fixture();
    expect(selectQaLiveCard(data)).toBe('curated');
    expect(qaLiveFrameSrc(data)).toContain('/api/qa/live/session/frame?session=');
    const oldKey = qaLiveViewerKey(data);
    data.current = null;
    data.vmBusy = 'catalog_verification';
    expect(selectQaLiveCard(data)).toBe('catalogBusy');
    expect(qaLiveFrameSrc(data)).toBeNull();
    data.vmBusy = null;
    expect(selectQaLiveCard(data)).toBe('next');
    data.queue.next = [];
    expect(selectQaLiveCard(data)).toBe('idle');
    expect(qaLiveViewerKey(data)).not.toBe(oldKey);
  });

  it('uses ordinary frame URLs after an owner change, with a new viewer key', () => {
    const data = fixture();
    const oldKey = qaLiveViewerKey(data);
    data.current = { wingetId: 'Example', displayName: 'Example', publisher: null, version: '1', catalogVersion: '1', architecture: 'x64', executionContext: 'LocalSystem', deployMode: 'Silent', dialogExpected: false, expectedUi: null, phase: 'installing', phaseStartedAt: null, startedAt: '2026-10-08T18:00:00Z', elapsedSeconds: 0 };
    data.viewer.candidateId = 'ordinary-id';
    expect(selectQaLiveCard(data)).toBe('ordinary');
    expect(qaLiveFrameSrc(data)).toBe('/api/qa/live/frame?candidate=ordinary-id&sequence=3');
    expect(qaLiveViewerKey(data)).not.toBe(oldKey);
    expect(qaLiveRefetchInterval(data)).toBe(1000);
  });

  it('never returns a frame URL for custom settings or unavailable evidence', () => {
    const data = fixture();
    if (data.current?.runKind === 'curated') data.current.verification = 'custom-settings';
    expect(qaLiveFrameSrc(data)).toBeNull();
    data.viewer.available = false;
    expect(qaLiveFrameSrc(data)).toBeNull();
    expect(qaLiveRefetchInterval(undefined)).toBe(10000);
  });
});
