import { unstable_cache } from 'next/cache';
import type { ReleaseHistoryFilters, ReleaseHistoryResult } from './release-history';

// Keep the existing five minute freshness and source request rate. A partial
// result is useful data with visible unavailable markers, not a failed refresh.
export const HISTORY_CACHE_SECONDS = 300;

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
  return unstable_cache(createHistoryCacheLoader(load), ['catalog-release-history-v8'], {
    revalidate: HISTORY_CACHE_SECONDS,
  });
}
