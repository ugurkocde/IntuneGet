import { unstable_cache } from 'next/cache';
import type { ReleaseHistoryFilters, ReleaseHistoryResult } from './release-history';

// Keep the existing five minute freshness and source request rate. A partial
// result is useful data with visible unavailable markers, not a failed refresh.
export const HISTORY_CACHE_SECONDS = 300;
export const HISTORY_RETAINED_MAX_AGE_MS = 30 * 60 * 1000;
const RETAINED_KEYS = 200;

type HistoryLoader = (filters: ReleaseHistoryFilters) => Promise<ReleaseHistoryResult>;

/** Counts only, best effort once per TTL per loader/serverless instance across
 * all filter keys. No row, filter, exception or request content is retained. */
export function createHistoryCacheLoader(load: HistoryLoader): HistoryLoader {
  let nextWarningAt = -Infinity;
  return async filters => {
    // Genuine source/deadline errors still propagate to Next's stale fallback.
    const result = await load(filters);
    const unavailablePairs = result.rows.filter(row => row.detailsUnavailable).length;
    const now = Date.now();
    if (unavailablePairs && now >= nextWarningAt) {
      nextWarningAt = now + HISTORY_CACHE_SECONDS * 1000;
      console.warn('Catalog release history details unavailable', {
        unavailablePairs, rows: result.rows.length, retryAfterSeconds: HISTORY_CACHE_SECONDS,
      });
    }
    return result;
  };
}

export function createHistoryLoader(load: HistoryLoader): HistoryLoader {
  const retained = new Map<string, ReleaseHistoryResult>();
  let nextFailureWarningAt = -Infinity;
  const admit = createHistoryCacheLoader(load);
  const keyOf = (f: ReleaseHistoryFilters) => JSON.stringify([
    f.app ?? '', f.query, f.month, f.kind, f.page, f.from ?? '', f.to ?? '', f.architecture ?? '',
  ]);
  const usable = (result: ReleaseHistoryResult, now: number) =>
    typeof result.loadedAt === 'number' && Number.isFinite(result.loadedAt)
    && now >= result.loadedAt && now - result.loadedAt < HISTORY_RETAINED_MAX_AGE_MS;
  const cached = unstable_cache(async (filters: ReleaseHistoryFilters) => {
    try {
      const result = await admit(filters);
      return { ...result, loadedAt: Date.now(), refreshFailedAt: undefined };
    } catch (error) {
      const previous = retained.get(keyOf(filters));
      const now = Date.now();
      // Pre-deployment entries have no known source age. Never re-age them or
      // retain beyond the bounded window, including through repeated failures.
      if (!previous || !usable(previous, now)) throw error;
      if (now >= nextFailureWarningAt) {
        nextFailureWarningAt = now + HISTORY_CACHE_SECONDS * 1000;
        console.warn('Catalog history refresh failed, serving retained result', {
          ageSeconds: Math.floor((now - previous.loadedAt!) / 1000),
          budgetExpired: error instanceof Error && error.cause instanceof Error
            && error.cause.name === 'TimeoutError',
        });
      }
      return { ...previous, refreshFailedAt: now };
    }
  }, ['catalog-release-history-v8'], {
    revalidate: HISTORY_CACHE_SECONDS,
  });
  return async filters => {
    // Next serves stale data before its background refresh settles. Retaining
    // that served value lets this instance return it when the refresh fails.
    const result = await cached(filters);
    const key = keyOf(filters);
    retained.delete(key);
    // Next can keep serving a failed refresh through its renewed TTL and stale
    // fallback. Enforce source age on every read, including fresh cache hits.
    if ((result.loadedAt !== undefined || result.refreshFailedAt !== undefined)
      && !usable(result, Date.now())) {
      throw new Error('Catalog history retained result expired');
    }
    if (usable(result, Date.now())) {
      retained.set(key, result);
      if (retained.size > RETAINED_KEYS) retained.delete(retained.keys().next().value!);
    }
    return result;
  };
}
