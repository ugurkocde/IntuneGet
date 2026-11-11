import { PACKAGE_UNAVAILABLE_MESSAGE, PACKAGE_VERSION_UNAVAILABLE_MESSAGE } from './package-eligibility';
import type { PackageCompatibilityBlock } from './package-eligibility';

export function unsupportedDependencyIdentifier(block: Pick<PackageCompatibilityBlock, 'code' | 'detail'> | null): string | null {
  if (block?.code !== 'unreviewed_dependency') return null;
  const match = /^WinGet dependency (\S+) is not in the reviewed redistribution allowlist\.$/.exec(block.detail);
  const identifier = match?.[1];
  const valid = match?.[0] === block.detail && identifier && identifier.length <= 128
    && /^(?:[A-Za-z0-9][A-Za-z0-9+_-]{0,31}\.){1,7}[A-Za-z0-9][A-Za-z0-9+_-]{0,31}$/.test(identifier);
  return valid ? identifier : null;
}

export function unsupportedDependencyMessage(block: Pick<PackageCompatibilityBlock, 'code' | 'detail'> | null) {
  if (block?.code !== 'unreviewed_dependency') return null;
  const identifier = unsupportedDependencyIdentifier(block);
  return identifier
    ? `This app requires ${identifier}, which is not supported yet. Automated deployment is blocked.`
    : 'This app requires a dependency that is not supported yet. Automated deployment is blocked.';
}

export function knownUnavailableDisposition(summary: string | null | undefined): { code: string; message: string } | null {
  if (summary === PACKAGE_VERSION_UNAVAILABLE_MESSAGE) return { code: 'VERSION_UNAVAILABLE', message: summary };
  if (summary === PACKAGE_UNAVAILABLE_MESSAGE) return { code: 'PACKAGE_UNAVAILABLE', message: summary };
  return null;
}

export interface PretestCandidate {
  id: string; status: string; phase: string | null; winget_id?: string | null; version?: string | null;
  architecture?: string | null; installer_sha256?: string | null; package_profile_sha256: string | null;
}
export function isExactPretestCandidate(candidate: PretestCandidate | null, expected: {
  candidateId: string | null; wingetId: string; version: string; architecture: string; hash: string; profile: string | null;
}): candidate is PretestCandidate {
  const sameDigest = (a: string | null | undefined, b: string | null) => typeof a === 'string' && typeof b === 'string'
    && /^[a-f0-9]{64}$/i.test(a) && /^[a-f0-9]{64}$/i.test(b) && a.toLowerCase() === b.toLowerCase();
  return !!candidate && candidate.id === expected.candidateId && candidate.status === 'error'
    && candidate.phase === 'scanning_installer' && candidate.winget_id === expected.wingetId
    && candidate.version === expected.version && candidate.architecture === expected.architecture
    && sameDigest(candidate.installer_sha256, expected.hash) && sameDigest(candidate.package_profile_sha256, expected.profile);
}
