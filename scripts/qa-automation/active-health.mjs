export const STALLED_MS = 10 * 60_000;

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
export async function reconcileActive({ candidate, invokeCron, snapshot, recoverPublication, dryRun = false, now = Date.now() }) {
  const health = activeHealth(candidate, now);
  if (!health.stale) return health;
  if (dryRun) return { action: 'would_reconcile_active', stale: true };
  const publication = await recoverPublication?.(candidate);
  if (publication) return { ...publication, snapshot: await snapshot() };
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
  return { action: 'repair_required', snapshot: current, reconciled,
    repairRequired: true, repairKey: 'qa-execution-stalled',
    repairReason: active?.status === 'dispatched'
      ? 'QA dispatch has no execution heartbeat after ten minutes.'
      : 'QA execution heartbeat remains stale after reconciliation.' };
}
