import { classifyForeignQaRuns } from './foreign-workflow-runs';

const LIVE_STATUSES = ['queued', 'waiting', 'pending', 'requested', 'in_progress'] as const;
type LiveStatus = typeof LIVE_STATUSES[number];
type LiveRun = { id: number; status: LiveStatus; path: string };
type Inventory = { total_count: number; workflow_runs: LiveRun[] };
type Result = { state: 'complete'; inventory: Inventory } | { state: 'unknown' };

/** Injected read-only transport must enforce its own request and overall deadline. */
export type ReadQaRunPage = (query: {
  workflow: 'intune-qa.yml'; status: LiveStatus; per_page: 100; page: number;
}) => Promise<unknown>;

const PAGE_SIZE = 100;
const MAX_PAGES_PER_STATUS = 2;

/**
 * Two complete status-filtered sweeps, at most 20 reads. Any incomplete or
 * changing evidence defers. This is evidence, not an atomic GitHub lock.
 * No candidate ownership, cancellation, dispatch or retry decisions are made.
 */
export async function readStableLiveQaInventory(readPage: ReadQaRunPage): Promise<Result> {
  const unknown: Result = { state: 'unknown' };
  async function sweep(): Promise<Inventory | null> {
    const runs: LiveRun[] = [];
    const seen = new Set<number>();
    for (const status of LIVE_STATUSES) {
      let total: number | undefined;
      let received = 0;
      let pages = 1;
      for (let page = 1; page <= pages; page++) {
        const raw = await readPage({ workflow: 'intune-qa.yml', status, per_page: PAGE_SIZE, page });
        if (!raw || typeof raw !== 'object') return null;
        const payload = raw as { total_count?: unknown; workflow_runs?: unknown };
        if (!Number.isSafeInteger(payload.total_count) || Number(payload.total_count) < 0 ||
            Number(payload.total_count) > PAGE_SIZE * MAX_PAGES_PER_STATUS ||
            !Array.isArray(payload.workflow_runs)) return null;
        if (total === undefined) {
          total = Number(payload.total_count);
          pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        } else if (payload.total_count !== total) return null;
        const expected = Math.min(PAGE_SIZE, Math.max(0, total - received));
        if (payload.workflow_runs.length !== expected) return null;
        for (const value of payload.workflow_runs) {
          if (!value || typeof value !== 'object') return null;
          const run = value as { id?: unknown; status?: unknown; path?: unknown };
          if (!Number.isSafeInteger(run.id) || Number(run.id) <= 0 || seen.has(Number(run.id)) ||
              run.status !== status || run.path !== '.github/workflows/intune-qa.yml') return null;
          seen.add(Number(run.id));
          runs.push({ id: Number(run.id), status, path: run.path });
        }
        received += payload.workflow_runs.length;
      }
      if (received !== total) return null;
    }
    runs.sort((a, b) => a.id - b.id);
    return { total_count: runs.length, workflow_runs: runs };
  }
  try {
    const first = await sweep();
    if (!first) return unknown;
    const second = await sweep();
    if (!second || JSON.stringify(first) !== JSON.stringify(second) ||
        classifyForeignQaRuns(second, []).state === 'unknown') return unknown;
    return { state: 'complete', inventory: second };
  } catch {
    return unknown;
  }
}
