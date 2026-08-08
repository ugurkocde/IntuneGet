import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildQaLiveResponse } from './live';

describe('buildQaLiveResponse', () => {
  it('returns a sanitized live projection and derives health', () => {
    const response = buildQaLiveResponse({
      now: new Date('2026-08-08T17:00:00.000Z'),
      current: {
        winget_id: 'Example.App',
        version: '2.0.0',
        architecture: 'x64',
        status: 'running',
        priority: 10,
        enqueued_at: '2026-08-08T16:30:00.000Z',
        dispatched_at: '2026-08-08T16:35:00.000Z',
        started_at: '2026-08-08T16:40:00.000Z',
        phase: 'installing',
        phase_started_at: '2026-08-08T16:45:00.000Z',
        phase_updated_at: '2026-08-08T16:59:00.000Z',
        test_config: {
          packageProfileCanonicalJson: JSON.stringify({ installer: { installScope: 'user' } }),
        },
        installer_url: 'https://secret.example/setup.exe',
        failure_summary: 'C:\\Users\\private',
        github_run_url: 'https://github.example/private',
      } as never,
      queuedCount: 1,
      queued: [],
      poll: {
        status: 'succeeded',
        started_at: '2026-08-08T16:50:00.000Z',
        finished_at: '2026-08-08T16:50:10.000Z',
        errors: [],
      },
      consecutivePollFailures: 0,
      recent: [],
      apps: [{
        winget_id: 'Example.App',
        name: 'Example',
        publisher: 'Example Corp',
        latest_version: '2.0.0',
      }],
    });

    expect(response.runner.state).toBe('testing');
    expect(response.scheduler.state).toBe('healthy');
    expect(response.scheduler).toMatchObject({ lastOutcome: 'succeeded', issue: null, consecutiveFailures: 0 });
    expect(response.current).toMatchObject({
      displayName: 'Example',
      phase: 'installing',
      executionContext: 'User',
      elapsedSeconds: 1200,
    });
    const serialized = JSON.stringify(response);
    for (const forbidden of ['installer_url', 'failure_summary', 'github_run_url', 'private']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('marks stale runners and abandoned poll runs as degraded', () => {
    const response = buildQaLiveResponse({
      now: new Date('2026-08-08T17:00:00.000Z'),
      current: {
        winget_id: 'Example.App', version: '2', architecture: 'x64', status: 'running',
        priority: 0, enqueued_at: '2026-08-08T15:00:00.000Z', dispatched_at: null,
        started_at: '2026-08-08T15:30:00.000Z', phase: null, phase_started_at: null,
        phase_updated_at: '2026-08-08T16:40:00.000Z', test_config: {},
      },
      queuedCount: 0,
      queued: [],
      poll: { status: 'running', started_at: '2026-08-08T16:00:00.000Z', finished_at: null, errors: [] },
      consecutivePollFailures: 2,
      recent: [],
      apps: [],
    });
    expect(response.runner.state).toBe('stalled');
    expect(response.scheduler.state).toBe('degraded');
    expect(response.scheduler.issue).toBe('stalled');
  });

  it('ignores phase evidence left behind by an earlier retry attempt', () => {
    const response = buildQaLiveResponse({
      now: new Date('2026-08-08T18:26:00.000Z'),
      current: {
        winget_id: 'Example.App', version: '2', architecture: 'x64', status: 'dispatched',
        priority: 0, enqueued_at: '2026-08-08T15:00:00.000Z',
        dispatched_at: '2026-08-08T18:25:40.000Z', started_at: null,
        phase: 'restoring_vm', phase_started_at: '2026-08-08T18:00:00.000Z',
        phase_updated_at: '2026-08-08T18:00:00.000Z', test_config: {},
      },
      queuedCount: 1,
      queued: [],
      poll: null,
      consecutivePollFailures: 0,
      recent: [],
      apps: [],
    });
    expect(response.runner).toEqual({
      state: 'testing',
      heartbeatAt: '2026-08-08T18:25:40.000Z',
    });
    expect(response.current?.phase).toBe('preparing_package');
    expect(response.current?.phaseStartedAt).toBeNull();
  });

  it('publishes only a sanitized GitHub rate-limit cause', () => {
    const response = buildQaLiveResponse({
      now: new Date('2026-08-08T19:11:00.000Z'),
      current: null,
      queuedCount: 0,
      queued: [],
      poll: {
        status: 'failed',
        started_at: '2026-08-08T19:10:00.000Z',
        finished_at: '2026-08-08T19:10:01.000Z',
        errors: ['system: WinGet change feed failed (403): API rate limit exceeded secret-detail'],
      },
      consecutivePollFailures: 2,
      recent: [],
      apps: [],
    });

    expect(response.scheduler).toMatchObject({
      state: 'degraded',
      lastOutcome: 'failed',
      issue: 'github_rate_limit',
      consecutiveFailures: 2,
    });
    expect(JSON.stringify(response)).not.toContain('secret-detail');
  });
});
