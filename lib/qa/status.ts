import type { QaBadgeState, QaStatus } from '@/types/qa';

/**
 * QA versions are intentionally compared as exact strings. WinGet versions
 * are not guaranteed to be valid semver and normalizing them could make a
 * result appear current when it was produced for a different manifest.
 */
export function deriveQaBadgeState(
  qa: QaStatus | null | undefined,
  catalogVersion: string | null | undefined
): QaBadgeState {
  if (!qa) return 'untested';

  const stale = !catalogVersion || qa.testedVersion !== catalogVersion;
  if (stale) {
    return qa.outcome === 'Passed' ? 'stale_passed' : 'stale_failed';
  }
  return qa.outcome === 'Passed' ? 'passed' : 'failed';
}

export function toQaStatus(row: {
  outcome: QaStatus['outcome'];
  tested_version: string;
  architecture: QaStatus['architecture'];
  tested_at_utc: string;
}): QaStatus {
  return {
    outcome: row.outcome,
    testedVersion: row.tested_version,
    architecture: row.architecture,
    testedAtUtc: row.tested_at_utc,
  };
}
