interface QaExecutionEvidence {
  attempts: number;
  dispatched_at: string | null;
  started_at: string | null;
  github_run_id: string | null;
  github_run_url: string | null;
}

export function qaTimeoutRecoveryUpdate(
  candidate: QaExecutionEvidence,
  now: string,
  maxAttempts: number
) {
  const exhausted = candidate.attempts >= maxAttempts;
  return {
    status: exhausted ? ('error' as const) : ('queued' as const),
    dispatched_at: exhausted ? candidate.dispatched_at : null,
    started_at: exhausted ? candidate.started_at : null,
    github_run_id: exhausted ? candidate.github_run_id : null,
    github_run_url: exhausted ? candidate.github_run_url : null,
    finished_at: exhausted ? now : null,
    failure_summary: exhausted
      ? 'The installation test did not finish before the safety timeout.'
      : null,
    ...(exhausted ? {} : {
      phase: null,
      phase_started_at: null,
      phase_updated_at: null,
    }),
    updated_at: now,
  };
}
