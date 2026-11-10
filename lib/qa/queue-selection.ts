import { isQaRunnerArchitectureSupported } from './candidate';
import { validateCurrentQaPackageProfile } from './package-profile';
import type { Json } from '@/types/database';
import type { InstallerSecurityHolds } from './installer-security-holds';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface QaQueueCandidate {
  id: string; winget_id: string; version: string; architecture: string;
  installer_sha256: string; package_profile_sha256: string | null;
  test_config: Json; priority: number; enqueued_at: string;
  next_retry_at?: string | null;
  status?: string;
  test_level?: string;
  demand_source?: string;
  catalog_version_at_enqueue?: string | null;
}

const STALE_LOOKUP_LIMIT = 1000;

function hasCatalogSnapshot(candidate: QaQueueCandidate): boolean {
  return candidate.status === 'queued' && candidate.test_level === 'psadt-package' &&
    ['managed', 'catalog'].includes(candidate.demand_source || '') &&
    typeof candidate.test_config === 'object' && candidate.test_config !== null &&
    !Array.isArray(candidate.test_config) && candidate.test_config.profileKind === 'catalog-default' &&
    typeof candidate.catalog_version_at_enqueue === 'string' && candidate.catalog_version_at_enqueue.length > 0;
}

/** Match the existing retry guard without ordering vendor version strings. */
export function isStaleQaCatalogCandidate(candidate: QaQueueCandidate, catalogVersion: unknown, exempt = false): boolean {
  return !exempt && hasCatalogSnapshot(candidate) && typeof catalogVersion === 'string' && catalogVersion.length > 0 &&
    catalogVersion !== candidate.catalog_version_at_enqueue && catalogVersion !== candidate.version;
}

/** Unknown or truncated demand evidence never authorizes background supersession. */
export async function loadStaleQaCatalogCandidateIds(supabase: SupabaseClient, candidates: readonly QaQueueCandidate[]): Promise<Set<string>> {
  const background = candidates.filter(hasCatalogSnapshot);
  if (!background.length) return new Set();
  const ids = background.map(c => c.id), apps = [...new Set(background.map(c => c.winget_id))];
  const versions = [...new Set(background.map(c => c.version))];
  const activeJobs = ['awaiting_qa', 'queued', 'packaging'];
  const reads = await Promise.all([
    supabase.from('curated_apps').select('winget_id,latest_version').in('winget_id', apps).limit(STALE_LOOKUP_LIMIT),
    supabase.from('qa_retest_grants').select('candidate_id').in('candidate_id', ids).limit(STALE_LOOKUP_LIMIT),
    supabase.from('qa_repair_requests').select('candidate_id').in('candidate_id', ids).limit(STALE_LOOKUP_LIMIT),
    supabase.from('packaging_jobs').select('qa_candidate_id').in('status', activeJobs).in('qa_candidate_id', ids).limit(STALE_LOOKUP_LIMIT),
    // Version-only filtering also catches case variants of the WinGet identity.
    supabase.from('packaging_jobs').select('winget_id,version,architecture,installer_sha256').in('status', activeJobs).in('version', versions).limit(STALE_LOOKUP_LIMIT),
  ]);
  if (reads.some(r => r.error)) throw new Error('QA catalog supersession evidence is unavailable');
  if (reads.some(r => !Array.isArray(r.data) || r.data.length >= STALE_LOOKUP_LIMIT)) return new Set();
  const [catalog, grants, repairs, linked, payloadJobs] = [
    reads[0].data!, reads[1].data!, reads[2].data!, reads[3].data!, reads[4].data!,
  ] as const;
  const exempt = new Set<string>();
  for (const row of [...grants, ...repairs]) {
    if (typeof row.candidate_id !== 'string') return new Set();
    exempt.add(row.candidate_id);
  }
  for (const row of linked) {
    if (typeof row.qa_candidate_id !== 'string') return new Set();
    exempt.add(row.qa_candidate_id);
  }
  const payloadKey = (row: { winget_id: string; version: string; architecture: string; installer_sha256: string }) =>
    JSON.stringify([row.winget_id.toLowerCase(), row.version, row.architecture, row.installer_sha256.toUpperCase()]);
  const payloadFields = ['winget_id', 'version', 'architecture', 'installer_sha256'] as const;
  if (payloadJobs.some(row => payloadFields.some(key => typeof row[key] !== 'string'))) return new Set();
  const demandedPayloads = new Set(payloadJobs.map(payloadKey));
  const stale = new Set<string>();
  for (const candidate of background) {
    const bindings = catalog.filter(row => row.winget_id === candidate.winget_id);
    if (bindings.length !== 1) continue;
    if (isStaleQaCatalogCandidate(candidate, bindings[0].latest_version,
      exempt.has(candidate.id) || demandedPayloads.has(payloadKey(candidate)))) stale.add(candidate.id);
  }
  return stale;
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
