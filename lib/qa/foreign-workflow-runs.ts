/** Pure classification only. A caller must provide complete GitHub inventory. */
export function classifyForeignQaRuns(
  payload: unknown,
  candidateRunIds: readonly (string | null)[]
): { state: 'clear' | 'foreign' | 'unknown'; runIds: number[] } {
  const unknown = { state: 'unknown' as const, runIds: [] };
  if (!payload || typeof payload !== 'object') return unknown;
  const inventory = payload as { total_count?: unknown; workflow_runs?: unknown };
  if (!Number.isSafeInteger(inventory.total_count) || !Array.isArray(inventory.workflow_runs) ||
      inventory.total_count !== inventory.workflow_runs.length) return unknown;
  const linked = new Set<string>();
  for (const id of candidateRunIds) {
    if (id === null) continue;
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return unknown;
    linked.add(id);
  }
  const live = new Set(['queued', 'waiting', 'pending', 'requested', 'in_progress']);
  const seen = new Set<number>();
  const foreign: number[] = [];
  for (const value of inventory.workflow_runs) {
    if (!value || typeof value !== 'object') return unknown;
    const run = value as { id?: unknown; status?: unknown; path?: unknown };
    if (!Number.isSafeInteger(run.id) || Number(run.id) <= 0 || seen.has(Number(run.id)) ||
        run.path !== '.github/workflows/intune-qa.yml' ||
        (run.status !== 'completed' && !live.has(String(run.status)))) return unknown;
    const id = Number(run.id);
    seen.add(id);
    if (run.status !== 'completed' && !linked.has(String(id))) foreign.push(id);
  }
  return foreign.length ? { state: 'foreign', runIds: foreign } : { state: 'clear', runIds: [] };
}
