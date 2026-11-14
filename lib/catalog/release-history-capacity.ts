import type { ReleaseHistoryFilters } from './release-history';

// Shared by every key and source in this server instance, not across the fleet.
const MAX_ACTIVE = 4;
const MAX_QUEUED = 8;
const WAIT_MS = 5_000;
let active = 0;
type Waiter = { grant: () => void; timer: ReturnType<typeof setTimeout> };
const waiting: Waiter[] = [];

function admissionError(admission: 'rejected' | 'wait_timeout', started: number) {
  console.warn('Catalog history RPC timing', {
    entryMs: 0, dispatchMs: null, headersMs: null,
    settledMs: performance.now() - started, category: 'error',
    budgetExpired: false, status: null, admission,
  });
  // Keep the public failure signature; admission failures are not successful reads.
  return new Error('Catalog history unavailable', { cause: new Error(`History admission ${admission}`) });
}

async function acquire() {
  if (active < MAX_ACTIVE) { active++; return; }
  const started = performance.now();
  if (waiting.length >= MAX_QUEUED) throw admissionError('rejected', started);
  await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      grant: resolve,
      timer: setTimeout(() => {
        const index = waiting.indexOf(waiter);
        if (index !== -1) waiting.splice(index, 1);
        reject(admissionError('wait_timeout', started));
      }, WAIT_MS),
    };
    waiting.push(waiter);
  });
}

/** A slot covers the RPC and its metadata reads. Only actual settlement releases
 * it; abandoning a caller or expiring an HTTP budget cannot admit extra work. */
export async function withHistoryCapacity<T>(load: () => Promise<T>): Promise<T> {
  await acquire();
  try { return await load(); }
  finally {
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); next.grant(); }
    else active--;
  }
}

const totals = new Map<string, { total: number; at: number }>();
const TOTAL_TTL_MS = 300_000;
function totalKey(filters: ReleaseHistoryFilters) {
  return JSON.stringify([filters.app ?? '', filters.query, filters.month, filters.kind,
    filters.from || null, filters.to || null, filters.architecture ?? '']);
}

export function rememberHistoryTotal(filters: ReleaseHistoryFilters, total: number) {
  if (!Number.isSafeInteger(total) || total < 0) return;
  const key = totalKey(filters);
  totals.delete(key);
  totals.set(key, { total, at: Date.now() });
  if (totals.size > 500) totals.delete(totals.keys().next().value!);
}

/** This is a recent successful count, with the same five minute freshness bound
 * as the page cache. Unknown or expired totals keep the existing cold read path. */
export function knownLastHistoryPage(filters: ReleaseHistoryFilters): number | null {
  const key = totalKey(filters);
  const known = totals.get(key);
  if (!known) return null;
  if (Date.now() - known.at >= TOTAL_TTL_MS) { totals.delete(key); return null; }
  return Math.max(1, Math.ceil(known.total / 40));
}
