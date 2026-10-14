import { isQaRunnerArchitectureSupported } from './candidate';
import { validateCurrentQaPackageProfile } from './package-profile';
import type { Json } from '@/types/database';
import type { InstallerSecurityHolds } from './installer-security-holds';

export interface QaQueueCandidate {
  id: string; winget_id: string; version: string; architecture: string;
  installer_sha256: string; package_profile_sha256: string | null;
  test_config: Json; priority: number; enqueued_at: string;
  next_retry_at?: string | null;
}

export function orderQaQueue<T extends { order(column: string, options: { ascending: boolean }): T }>(query: T): T {
  return query.order('priority', { ascending: false })
    .order('enqueued_at', { ascending: true }).order('id', { ascending: true });
}

// Shared by the dispatcher and public queue. Reasons remain private.
export function qaQueueCandidateReason(candidate: QaQueueCandidate, now: Date, holds: InstallerSecurityHolds = new Map()): string | null {
  if (holds.has(candidate.installer_sha256.toLowerCase())) return 'installer-security-hold';
  if (!Number.isInteger(candidate.priority) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate.id) ||
      !Number.isFinite(Date.parse(candidate.enqueued_at))) return 'queue-metadata-invalid';
  if (!candidate.next_retry_at || (candidate.next_retry_at !== '-infinity' && !Number.isFinite(Date.parse(candidate.next_retry_at)))) return 'queue-retry-missing';
  if (candidate.next_retry_at && Date.parse(candidate.next_retry_at) > now.getTime()) return 'source-retry-pending';
  if (!isQaRunnerArchitectureSupported(candidate.architecture)) return 'runner-architecture-unsupported';
  const validation = validateCurrentQaPackageProfile({
    testConfig: candidate.test_config, candidatePackageProfileSha256: candidate.package_profile_sha256,
    candidateWingetId: candidate.winget_id, candidateVersion: candidate.version,
    candidateArchitecture: candidate.architecture, candidateInstallerSha256: candidate.installer_sha256,
  });
  return validation.valid ? null : validation.reason;
}
