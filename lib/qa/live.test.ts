import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildQaLiveResponse } from './live';

describe('buildQaLiveResponse', () => {
  it('returns a sanitized live projection and derives health', () => {
    const response = buildQaLiveResponse({
      now: new Date('2026-08-08T17:00:00.000Z'),
      current: {
        id: '11111111-1111-1111-1111-111111111111',
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
        activity_updated_at: '2026-08-08T16:58:30.000Z',
        log_updated_at: '2026-08-08T16:59:30.000Z',
        live_activity: {
          stage: 'during_install',
          counts: {
            registryAdded: 2, registryChanged: 1, registryRemoved: 0,
            filesAdded: 12, filesChanged: 3, filesRemoved: 0,
          },
          items: [
            { kind: 'file', change: 'added', target: '%PROGRAMFILES%\\Example\\Example.exe' },
            { kind: 'registry', change: 'changed', target: 'HKLM\\SOFTWARE\\Example\\Version' },
          ],
          truncated: false,
        },
        live_log: {
          source: 'PSADT',
          lastWriteAt: '2026-08-08T16:59:28.000Z',
          lines: ['Installing Example…', 'Vendor installer is running.'],
        },
        test_config: {
          packageProfileCanonicalJson: JSON.stringify({
            installer: { installScope: 'user' },
            psadtConfig: {
              deployMode: 'NonInteractive', restartBehavior: 'Prompt', processesToClose: [{ name: 'private-process' }],
              showClosePrompt: true, allowDefer: true, progressDialog: { enabled: true },
              customPrompts: [{ enabled: true, message: 'private-message' }], restartPrompt: { enabled: false },
              balloonTips: [{ enabled: true, text: 'private-notification' }],
            },
          }),
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
      frame: {
        candidate_id: '11111111-1111-1111-1111-111111111111',
        sequence: 42,
        captured_at: '2026-08-08T16:59:58.000Z',
        updated_at: '2026-08-08T16:59:59.000Z',
        width: 1280,
        height: 720,
      },
    });

    expect(response.runner.state).toBe('testing');
    expect(response.scheduler.state).toBe('healthy');
    expect(response.scheduler).toMatchObject({ lastOutcome: 'succeeded', issue: null, consecutiveFailures: 0 });
    expect(response.current).toMatchObject({
      displayName: 'Example',
      phase: 'installing',
      executionContext: 'User',
      deployMode: 'NonInteractive',
      dialogExpected: true,
      expectedUi: {
        deployMode: 'NonInteractive',
        restartBehavior: 'Prompt',
        promptConfiguration: {
          closePrompt: true,
          deferral: true,
          progressDialog: true,
          customPromptCount: 1,
          restartPrompt: false,
          balloonTipCount: 1,
        },
        processCloseCount: 1,
        uiEvidenceExpected: true,
      },
      elapsedSeconds: 1200,
    });
    expect(response.viewer).toEqual({
      candidateId: '11111111-1111-1111-1111-111111111111',
      available: true,
      capturedAt: '2026-08-08T16:59:59.000Z',
      sequence: 42,
      width: 1280,
      height: 720,
    });
    expect(response.activity).toEqual({
      stage: 'during_install',
      observedAt: '2026-08-08T16:58:30.000Z',
      counts: {
        registryAdded: 2, registryChanged: 1, registryRemoved: 0,
        filesAdded: 12, filesChanged: 3, filesRemoved: 0,
      },
      items: [
        { kind: 'file', change: 'added', target: '%PROGRAMFILES%\\Example\\Example.exe' },
        { kind: 'registry', change: 'changed', target: 'HKLM\\SOFTWARE\\Example\\Version' },
      ],
      truncated: false,
    });
    expect(response.log).toEqual({
      source: 'PSADT',
      observedAt: '2026-08-08T16:59:30.000Z',
      lastWriteAt: '2026-08-08T16:59:28.000Z',
      lines: ['Installing Example…', 'Vendor installer is running.'],
    });
    const serialized = JSON.stringify(response);
    for (const forbidden of ['installer_url', 'failure_summary', 'github_run_url', 'private', 'vendorSilentArguments']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('marks stale runners and abandoned poll runs as degraded', () => {
    const response = buildQaLiveResponse({
      now: new Date('2026-08-08T17:00:00.000Z'),
      current: {
        id: '22222222-2222-2222-2222-222222222222',
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
      frame: null,
    });
    expect(response.runner.state).toBe('stalled');
    expect(response.scheduler.state).toBe('degraded');
    expect(response.scheduler.issue).toBe('stalled');
  });

  it('ignores phase evidence left behind by an earlier retry attempt', () => {
    const response = buildQaLiveResponse({
      now: new Date('2026-08-08T18:26:00.000Z'),
      current: {
        id: '33333333-3333-3333-3333-333333333333',
        winget_id: 'Example.App', version: '2', architecture: 'x64', status: 'dispatched',
        priority: 0, enqueued_at: '2026-08-08T15:00:00.000Z',
        dispatched_at: '2026-08-08T18:25:40.000Z', started_at: null,
        phase: 'restoring_vm', phase_started_at: '2026-08-08T18:00:00.000Z',
        phase_updated_at: '2026-08-08T18:00:00.000Z', test_config: {},
        activity_updated_at: '2026-08-08T18:00:00.000Z',
        log_updated_at: '2026-08-08T18:00:00.000Z',
        live_activity: {
          stage: 'after_install',
          counts: { registryAdded: 1, registryChanged: 0, registryRemoved: 0, filesAdded: 1, filesChanged: 0, filesRemoved: 0 },
          items: [{ kind: 'file', change: 'added', target: '%PROGRAMFILES%\\Old\\old.exe' }],
          truncated: false,
        },
        live_log: { source: 'PSADT', lastWriteAt: '2026-08-08T18:00:00.000Z', lines: ['old'] },
      },
      queuedCount: 1,
      queued: [],
      poll: null,
      consecutivePollFailures: 0,
      recent: [],
      apps: [],
      frame: null,
    });
    expect(response.runner).toEqual({
      state: 'testing',
      heartbeatAt: '2026-08-08T18:25:40.000Z',
    });
    expect(response.current?.phase).toBe('preparing_package');
    expect(response.current?.phaseStartedAt).toBeNull();
    expect(response.current?.expectedUi).toBeNull();
    expect(response.activity).toBeNull();
    expect(response.log).toBeNull();
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
      frame: null,
    });

    expect(response.scheduler).toMatchObject({
      state: 'degraded',
      lastOutcome: 'failed',
      issue: 'github_rate_limit',
      consecutiveFailures: 2,
    });
    expect(JSON.stringify(response)).not.toContain('secret-detail');
  });

  it('identifies a persisted GitHub cooldown as a rate limit', () => {
    const response = buildQaLiveResponse({
      now: new Date('2026-08-10T07:11:00.000Z'),
      current: null,
      queuedCount: 0,
      queued: [],
      poll: {
        status: 'partial',
        started_at: '2026-08-10T07:10:47.000Z',
        finished_at: '2026-08-10T07:10:49.000Z',
        errors: ['system: WinGet GitHub change feed paused until 2026-08-10T07:33:39.000Z'],
      },
      consecutivePollFailures: 1,
      recent: [],
      apps: [],
      frame: null,
    });

    expect(response.scheduler).toMatchObject({
      state: 'degraded',
      lastOutcome: 'partial',
      issue: 'github_rate_limit',
    });
  });
});
