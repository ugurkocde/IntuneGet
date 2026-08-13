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
  if (!qa || qa.testLevel !== 'psadt-package') return 'untested';

  if (qa.outcome === 'Queued' || qa.outcome === 'Running') {
    return qa.outcome.toLowerCase() as 'queued' | 'running';
  }

  const stale = !catalogVersion || qa.testedVersion !== catalogVersion;
  if (stale) {
    return qa.outcome === 'Passed' ? 'stale_passed' : 'stale_failed';
  }
  return qa.outcome === 'Passed' ? 'passed' : 'failed';
}

export function toQaStatus(row: {
  outcome: 'Passed' | 'Failed';
  tested_version: string;
  architecture: QaStatus['architecture'];
  tested_at_utc: string;
  test_level: QaStatus['testLevel'];
  package_profile_sha256: string | null;
}): QaStatus {
  return {
    outcome: row.outcome,
    testedVersion: row.tested_version,
    architecture: row.architecture,
    testedAtUtc: row.tested_at_utc,
    testLevel: row.test_level,
    packageProfileSha256: row.package_profile_sha256 || undefined,
  };
}

export function toQaCandidateStatus(row: {
  status: 'queued' | 'dispatched' | 'running';
  version: string;
  architecture: QaStatus['architecture'];
  installer_sha256: string;
  enqueued_at: string;
  started_at: string | null;
  test_level: QaStatus['testLevel'];
  package_profile_sha256: string | null;
}): QaStatus {
  return {
    outcome: row.status === 'running' ? 'Running' : 'Queued',
    testedVersion: row.version,
    architecture: row.architecture,
    testedAtUtc: row.started_at || row.enqueued_at,
    installerSha256: row.installer_sha256,
    testLevel: row.test_level,
    packageProfileSha256: row.package_profile_sha256 || undefined,
  };
}
