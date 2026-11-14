export const STALLED_MS = 10 * 60_000;

/** Observe runner Execute steps, never infer VM boots from dispatch bookkeeping. */
export function completedHourStarts({ now = Date.now(), runs, jobsByRun, complete = true }) {
  const end = Math.floor(now / 3_600_000) * 3_600_000;
  const start = end - 3_600_000;
  const window = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  if (!complete || !Array.isArray(runs) || !jobsByRun) {
    return { window, executeStarts: null, unknownRuns: null, state: 'unknown' };
  }
  let executeStarts = 0;
  let unknownRuns = 0;
  for (const run of runs) {
    const data = jobsByRun[run.id];
    let unknown = false;
    if (!data || !Array.isArray(data.jobs) || !Number.isSafeInteger(data.total_count) ||
        data.total_count > 100 || data.total_count !== data.jobs.length) {
      unknownRuns++;
      continue;
    }
    for (const job of data.jobs.filter(job => job.name === 'qa')) {
      if (!Array.isArray(job.steps)) { unknown = true; continue; }
      const step = job.steps.find(step => step.name === 'Execute isolated QA test');
      if (!step) { if (!['queued', 'waiting'].includes(job.status)) unknown = true; continue; }
      if (step.conclusion === 'skipped' || step.started_at == null) continue;
      const started = Date.parse(step.started_at);
      if (!Number.isFinite(started) || step.conclusion === 'cancelled') { unknown = true; continue; }
      if (step.status === 'in_progress' || ['success', 'failure'].includes(step.conclusion)) {
        if (started >= start && started < end) executeStarts++;
      } else unknown = true;
    }
    if (!data.jobs.some(job => job.name === 'qa') && !['queued', 'waiting', 'requested'].includes(run.status)) unknown = true;
    if (unknown) unknownRuns++;
  }
  return { window, executeStarts: unknownRuns ? null : executeStarts, unknownRuns,
    state: unknownRuns ? 'unknown' : executeStarts ? 'started' : 'zero' };
}

export function activeHealth(candidate, now = Date.now()) {
  if (!candidate) return { action: 'idle_waiting_for_work', stale: false };
  // Bookkeeping updates are not execution heartbeats. In particular, retries
  // must not make an unstarted dispatch look like a healthy VM lifecycle.
  const values = candidate.status === 'dispatched'
    ? [candidate.dispatched_at]
    : [candidate.activity_updated_at, candidate.phase_updated_at, candidate.started_at];
  const times = values.map(value => Date.parse(value || '')).filter(Number.isFinite);
  const ageMs = times.length ? now - Math.max(...times) : Infinity;
  const stale = ageMs >= STALLED_MS;
  return { stale, ageMs, action: stale ? 'active_stalled'
    : candidate.status === 'dispatched' ? 'awaiting_runner' : 'active_healthy' };
}

/** Recheck real execution after reconciliation; HTTP 200/qa_active is not health. */
export async function reconcileActive({ candidate, invokeCron, snapshot, recoverPublication, holdPublication, dryRun = false, now = Date.now() }) {
  const health = activeHealth(candidate, now);
  if (!health.stale) return health;
  if (dryRun) return { action: 'would_reconcile_active', stale: true };
  const publication = await recoverPublication?.(candidate);
  if (publication) {
    const current = await snapshot();
    if (publication.repairRequired && current.active[0]?.id === candidate.id) {
      const held = await holdPublication?.(current.active[0]);
      if (held) return { ...held, snapshot: await snapshot() };
    }
    return { ...publication, snapshot: current };
  }
  const reconciled = await invokeCron('/api/cron/qa-dispatch');
  const current = await snapshot();
  const active = current.active[0];
  const after = activeHealth(active, now);
  if (!after.stale) return { ...after, snapshot: current, reconciled };
  if (reconciled.body?.reason === 'stale_waiting_run_cancelled') {
    return { action: 'dispatch_recovery_waiting', snapshot: current, reconciled };
  }
  if (reconciled.body?.reason === 'github_actions_unavailable') {
    return { action: 'github_actions_unavailable', snapshot: current, reconciled };
  }
  if (active?.id === candidate.id) {
    const held = await holdPublication?.(active);
    if (held) return { ...held, snapshot: await snapshot(), reconciled };
  }
  return { action: 'repair_required', snapshot: current, reconciled,
    repairRequired: true, repairKey: 'qa-execution-stalled',
    repairReason: active?.status === 'dispatched'
      ? 'QA dispatch has no execution heartbeat after ten minutes.'
      : 'QA execution heartbeat remains stale after reconciliation.' };
}
