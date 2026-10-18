import type { PackagingJob } from '@/lib/db/types';
import type { CustomerQaStatus } from '@/types/customer-qa';
import { createServerClient, isSupabaseServerConfigured } from '@/lib/supabase';
import { loadInstallerSecurityHolds, installerSecurityReason } from '@/lib/qa/installer-security-holds';
import { qaSourceKey, qaSourceRetryAtMany } from '@/lib/qa/source-backoff';
import type { Database } from '@/types/database';
import { describeQaGateError, QaGateNotPassedError } from '@/lib/qa/gate';

type Candidate = Pick<Database['public']['Tables']['qa_candidates']['Row'], 'id' | 'winget_id' | 'version' | 'architecture' | 'installer_url' | 'installer_sha256' | 'package_profile_sha256' | 'status' | 'phase' | 'next_retry_at'>;
type Result = Pick<Database['public']['Tables']['qa_package_results']['Row'], 'package_profile_sha256' | 'winget_id' | 'tested_version' | 'architecture' | 'installer_sha256' | 'virustotal_status' | 'virustotal_malicious' | 'virustotal_suspicious'>;
const unavailable: CustomerQaStatus = { category: 'unavailable', message: 'Validation status is temporarily unavailable. Next event: updated validation information.', nextEventAt: null };
const reputationUnknown: CustomerQaStatus = { category: 'reputation_unknown', message: 'Installer reputation is not yet verified. Next event: a verified security verdict.', nextEventAt: null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/i;
const time = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const same = (a: string | null, b: string | null) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const tupleMatches = (job: PackagingJob, row: Candidate) => same(job.winget_id, row.winget_id) && job.version === row.version && same(job.architecture, row.architecture) && same(job.installer_sha256, row.installer_sha256);

/** Recognize a recorded gate disposition without rendering arbitrary stored text. */
function storedReputationHold(job: PackagingJob): CustomerQaStatus {
  if (job.error_code !== null && job.error_code !== 'QA_NOT_PASSED_CURRENT_VERSION') return { ...unavailable };
  const expected = describeQaGateError(new QaGateNotPassedError({
    wingetId: job.winget_id, version: job.version, architecture: (job.architecture || 'x64').toLowerCase(),
    installerSha256: '', packageProfileSha256: '', reason: 'reputation',
  }));
  return { ...(job.status_message === expected ? reputationUnknown : unavailable) };
}

// Called only with jobs already authorized by the package GET route. These
// SELECTs supply display evidence; none of their results decide a write.
export async function enrichCustomerQaStatus<T extends PackagingJob>(jobs: T[]): Promise<Array<T & { qa_status?: CustomerQaStatus }>> {
  const waiting = jobs.filter(job => job.status === 'awaiting_qa');
  if (!waiting.length) return jobs;
  const fallback = () => jobs.map(job => job.status === 'awaiting_qa' ? { ...job, qa_status: storedReputationHold(job) } : job);
  const ids = [...new Set(waiting.map(job => job.qa_candidate_id).filter((id): id is string => typeof id === 'string' && uuid.test(id)))];
  if (!isSupabaseServerConfigured() || !ids.length || ids.length > 50) return fallback();
  try {
    const client = createServerClient();
    const candidates = await client.from('qa_candidates')
      .select('id,winget_id,version,architecture,installer_url,installer_sha256,package_profile_sha256,status,phase,next_retry_at')
      .in('id', ids).limit(ids.length + 1);
    if (candidates.error || (candidates.data?.length ?? 0) > ids.length) return fallback();
    const rows = (candidates.data || []).filter(row => ids.includes(row.id) && digest.test(row.installer_sha256));
    const profiles = [...new Set(rows.map(row => row.package_profile_sha256).filter((p): p is string => typeof p === 'string' && digest.test(p)))];
    const hashes = [...new Set(rows.map(row => row.installer_sha256.toLowerCase()))];
    const [holds, retries, results, reputation] = await Promise.all([
      loadInstallerSecurityHolds(client, rows.map(row => row.installer_sha256)),
      qaSourceRetryAtMany(client, rows.map(qaSourceKey)),
      profiles.length ? client.from('qa_package_results')
        .select('package_profile_sha256,winget_id,tested_version,architecture,installer_sha256,virustotal_status,virustotal_malicious,virustotal_suspicious')
        .in('package_profile_sha256', profiles).limit(profiles.length + 1) : Promise.resolve({ data: [], error: null }),
      hashes.length ? client.from('catalog_file_reputation').select('sha256,status,malicious,suspicious')
        .in('sha256', hashes).limit(hashes.length + 1) : Promise.resolve({ data: [], error: null }),
    ]);
    if (results.error || (results.data?.length ?? 0) > profiles.length || reputation.error || (reputation.data?.length ?? 0) > hashes.length) return fallback();
    return jobs.map(job => {
      if (job.status !== 'awaiting_qa') return job;
      const candidate = rows.find(row => row.id === job.qa_candidate_id);
      if (!candidate || !tupleMatches(job, candidate)) return { ...job, qa_status: storedReputationHold(job) };
      const hold = holds.get(candidate.installer_sha256.toLowerCase());
      const cached = reputation.data?.find(row => same(row.sha256, candidate.installer_sha256));
      const result = (results.data as Result[]).find(row => row.package_profile_sha256 === candidate.package_profile_sha256 && same(row.winget_id, candidate.winget_id) && row.tested_version === candidate.version && same(row.architecture, candidate.architecture) && same(row.installer_sha256, candidate.installer_sha256));
      let status: CustomerQaStatus;
      if (hold) status = { category: 'installer_security_hold', message: hold.reason + ' Next event: a scheduled security check.', nextEventAt: time(hold.nextCheckAt) };
      else if ((cached?.malicious ?? 0) > 0 || (cached?.suspicious ?? 0) > 0 || (result && ((result.virustotal_malicious ?? 0) > 0 || (result.virustotal_suspicious ?? 0) > 0 || ['flagged', 'suspicious'].includes(result.virustotal_status ?? '')))) {
        const malicious = Math.max(cached?.malicious ?? 0, result?.virustotal_malicious ?? 0);
        status = { category: 'installer_security_hold', message: Number.isInteger(malicious) && malicious > 0 ? installerSecurityReason(malicious) + ' Next event: updated security evidence.' : 'Installer security review is required. Next event: updated security evidence.', nextEventAt: null };
      } else {
        const sourceTimes = [candidate.next_retry_at, retries.get(qaSourceKey(candidate))].map(time).filter((t): t is string => t !== null && Date.parse(t) > Date.now()).sort();
        if (sourceTimes.length) status = { category: 'source_retry', message: 'Installer source checks are deferred. Next event: a scheduled source check.', nextEventAt: sourceTimes.at(-1)! };
        else if (result && (!result.virustotal_status || ['not_found', 'error', 'skipped', 'unknown'].includes(result.virustotal_status))) status = { ...reputationUnknown };
        else if (candidate.phase === 'publishing') status = { category: 'publication', message: 'Installation validation has finished. Next event: publication of the verified result.', nextEventAt: null };
        else if (['dispatched', 'running'].includes(candidate.status)) status = { category: 'testing', message: 'Installation validation is in progress. Next event: the completed validation result.', nextEventAt: null };
        else if (candidate.status === 'queued') status = { category: 'queued', message: 'Waiting for installation validation. Next event: an available validation slot.', nextEventAt: null };
        else status = storedReputationHold(job);
      }
      return { ...job, qa_status: status };
    });
  } catch {
    // Never fail the authorized job list or expose raw database/provider errors.
    return fallback();
  }
}
