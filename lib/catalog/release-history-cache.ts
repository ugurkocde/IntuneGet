import type { ReleaseHistoryResult } from './release-history';

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
