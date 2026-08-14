const INSTALLER_SOURCE_QUARANTINE_PREFIX = 'Installer source quarantined before QA:';

export function shouldReactivateSupersededCandidate(
  status: string | null | undefined,
  failureSummary: string | null | undefined,
): boolean {
  return status === 'superseded' &&
    !failureSummary?.startsWith(INSTALLER_SOURCE_QUARANTINE_PREFIX);
}
