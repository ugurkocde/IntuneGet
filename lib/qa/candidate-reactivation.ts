const INSTALLER_SOURCE_QUARANTINE_PREFIX = 'Installer source quarantined before QA:';

export function shouldReactivateSupersededCandidate(
  status: string | null | undefined,
  failureSummary: string | null | undefined,
  packagingContractValid: boolean,
): boolean {
  // Reconciliation may rediscover the same immutable tuple after its first
  // preflight. Never turn a deliberate packaging-contract rejection back into
  // executable work merely because the insert collided with that old row.
  return packagingContractValid &&
    status === 'superseded' &&
    !failureSummary?.startsWith(INSTALLER_SOURCE_QUARANTINE_PREFIX);
}
