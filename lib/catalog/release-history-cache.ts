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

/** Catalog payload only. loadedAt and refreshFailedAt are cache bookkeeping. */
function historyContentKey(value: ReleaseHistoryResult): string {
  const { loadedAt: _loadedAt, refreshFailedAt: _refreshFailedAt, ...content } = value;
  return stableStringify(content);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().flatMap((key) => {
    if (record[key] === undefined) return [];
    return `${JSON.stringify(key)}:${stableStringify(record[key])}`;
  }).join(',')}}`;
}

export function createHistoryLoader(load: HistoryLoader): HistoryLoader {
  const retained = new Map<string, ReleaseHistoryResult>();
  const pending = new Map<string, Promise<ReleaseHistoryResult>>();
  // When a refresh confirms the same catalog payload, loadedAt stays put so the
  // data cache body does not change. This map records that confirmation so the
  // 30-minute source-age guard does not refetch on every later request.
  const confirmedAt = new Map<string, number>();
  let nextFailureWarningAt = -Infinity;
  const admit = createHistoryCacheLoader(load);
  const keyOf = (f: ReleaseHistoryFilters) => JSON.stringify([
    f.app ?? '', f.query, f.month, f.kind, f.page, f.from ?? '', f.to ?? '', f.architecture ?? '',
  ]);
  const usable = (result: ReleaseHistoryResult, now: number) =>
    typeof result.loadedAt === 'number' && Number.isFinite(result.loadedAt)
    && now >= result.loadedAt && now - result.loadedAt < HISTORY_RETAINED_MAX_AGE_MS;
  const remember = (key: string, result: ReleaseHistoryResult) => {
    const current = retained.get(key);
    if (current?.loadedAt !== undefined && result.loadedAt !== undefined
      && current.loadedAt > result.loadedAt) return;
    retained.delete(key);
    retained.set(key, result);
    if (retained.size > RETAINED_KEYS) {
      const oldest = retained.keys().next().value!;
      retained.delete(oldest);
      confirmedAt.delete(oldest);
    }
  };
  // Both Next's background refresh and an expired idle-key foreground read
  // join the same source operation. Store before invoking the source.
  const refresh = (filters: ReleaseHistoryFilters): Promise<ReleaseHistoryResult> => {
    const key = keyOf(filters);
    const existing = pending.get(key);
    if (existing) return existing;
    const operation = Promise.resolve().then(async () => {
    try {
      const result = await admit(filters);
      const previous = retained.get(key);
      // Identical catalog data keeps the stored timestamp. A new loadedAt on
      // every 5-minute refresh rewrote the data cache and billed an ISR write.
      let loadedAt = Date.now();
      if (
        previous !== undefined
        && previous.refreshFailedAt === undefined
        && typeof previous.loadedAt === 'number'
        && historyContentKey(previous) === historyContentKey(result)
      ) {
        loadedAt = previous.loadedAt;
      }
      const fresh = { ...result, loadedAt, refreshFailedAt: undefined };
      confirmedAt.set(key, Date.now());
      remember(key, fresh);
      return fresh;
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
    }).finally(() => { if (pending.get(key) === operation) pending.delete(key); });
    pending.set(key, operation);
    return operation;
  };
  const cached = unstable_cache((filters: ReleaseHistoryFilters) => refresh(filters), ['catalog-release-history-v8'], {
    revalidate: HISTORY_CACHE_SECONDS,
  });
  return async filters => {
    // Next serves stale data before its background refresh settles. Retaining
    // that served value lets this instance return it when the refresh fails.
    let result = await cached(filters);
    const key = keyOf(filters);
    // Next can keep serving a failed refresh through its renewed TTL and stale
    // fallback. Enforce source age on every read, including fresh cache hits.
    if (result.refreshFailedAt !== undefined && !usable(result, Date.now())) {
      throw new Error('Catalog history retained result expired');
    }
    if (result.refreshFailedAt === undefined && typeof result.loadedAt === 'number' && Number.isFinite(result.loadedAt)
      && Date.now() - result.loadedAt >= HISTORY_RETAINED_MAX_AGE_MS) {
      // An unmarked idle cache entry is not proof that its source is failing.
      // A fast background refresh may already have settled before cached()
      // returns its stale value; reuse that observation rather than reload.
      // A recent confirmation of this same payload is enough: its loadedAt
      // intentionally stays old so the stored cache body does not change.
      const now = Date.now();
      const fresh = retained.get(key);
      const seen = confirmedAt.get(key);
      const confirmed = typeof seen === 'number' && Number.isFinite(seen) && now >= seen
        && now - seen < HISTORY_RETAINED_MAX_AGE_MS
        && fresh !== undefined
        && fresh.refreshFailedAt === undefined
        && historyContentKey(fresh) === historyContentKey(result);
      if (!confirmed) {
        result = fresh && usable(fresh, now) && fresh.loadedAt! > result.loadedAt
          ? fresh : await refresh(filters);
      }
    }
    if (result.refreshFailedAt !== undefined && !usable(result, Date.now())) {
      throw new Error('Catalog history retained result expired');
    }
    if (usable(result, Date.now())) {
      remember(key, result);
    }
    return result;
  };
}
