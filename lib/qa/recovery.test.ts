import { describe, expect, it } from 'vitest';
import { qaTimeoutRecoveryUpdate } from './recovery';

const execution = {
  attempts: 1,
  dispatched_at: '2026-08-07T20:35:20.000Z',
  started_at: '2026-08-07T20:35:37.000Z',
  github_run_id: '31216520295',
  github_run_url: 'https://github.com/example/workflows/actions/runs/31216520295',
};

describe('qaTimeoutRecoveryUpdate', () => {
  it('clears per-attempt evidence when the candidate will be retried', () => {
    expect(qaTimeoutRecoveryUpdate(execution, '2026-08-07T20:50:00.000Z', 2)).toMatchObject({
      status: 'queued',
      dispatched_at: null,
      started_at: null,
      github_run_id: null,
      github_run_url: null,
      finished_at: null,
      failure_summary: null,
      phase: null,
      phase_started_at: null,
      phase_updated_at: null,
    });
  });

  it('preserves final-run evidence when the timeout exhausts retries', () => {
    expect(
      qaTimeoutRecoveryUpdate(
        { ...execution, attempts: 2 },
        '2026-08-07T20:50:00.000Z',
        2
      )
    ).toEqual({
      status: 'error',
      dispatched_at: execution.dispatched_at,
      started_at: execution.started_at,
      github_run_id: execution.github_run_id,
      github_run_url: execution.github_run_url,
      finished_at: '2026-08-07T20:50:00.000Z',
      failure_summary: 'QA workflow did not report completion before the safety timeout.',
      updated_at: '2026-08-07T20:50:00.000Z',
    });
  });
});
