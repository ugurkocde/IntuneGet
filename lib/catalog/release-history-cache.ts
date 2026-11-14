import type { ReleaseHistoryFilters, ReleaseHistoryResult } from './release-history';
import type { CatalogSource } from './types';

export class CompleteHistoryError extends Error {
  constructor(public readonly result: ReleaseHistoryResult) {
    super('Release history metadata is incomplete');
    Object.defineProperty(this, 'result', {value: result, enumerable: false});
  }
}

/** Throw inside the cache callback so degraded results are never stored. The
 * caller can still render partial records on a cold request, while Next retains
 * the previous complete result if background revalidation fails. */
export function requireCompleteHistory(result: ReleaseHistoryResult) {
  if (result.rows.some(row => row.detailsUnavailable)) throw new CompleteHistoryError(result);
  return result;
}

// Next shares stored values across requests, but its pending revalidations are
// request-local. Share only active work here; results still belong to Next's
// cache. This coordinates one server instance, not separate Vercel instances.
const inFlight = new Map<string, Promise<unknown>>();
function singleFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const pending = Promise.resolve().then(load);
  inFlight.set(key, pending);
  void pending.finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }).catch(() => {});
  return pending;
}

export async function loadCompleteHistory(source: Pick<CatalogSource, 'getReleaseHistory'>, filters: ReleaseHistoryFilters) {
  return requireCompleteHistory(await singleFlight('history:' + JSON.stringify(filters), () => source.getReleaseHistory(filters)));
}

export function countRecentUpdates(source: Pick<CatalogSource, 'countReleaseHistory'>, from: string) {
  return singleFlight('recent:' + JSON.stringify(from), () =>
    source.countReleaseHistory({ query: '', month: '', kind: 'updated', page: 1, from }));
}
