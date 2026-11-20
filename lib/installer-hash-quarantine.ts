import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export const HASH_QUARANTINE_PREFIX = 'Installer source quarantined before QA: HASH_MISMATCH. ';
export const HASH_QUARANTINE_MESSAGE = 'Installer source checks stopped this deployment before the installation test ran.';
type Candidate = Pick<Database['public']['Tables']['qa_candidates']['Row'], 'id' | 'winget_id' | 'version' | 'architecture' | 'installer_sha256' | 'package_profile_sha256' | 'status' | 'phase' | 'github_run_id' | 'started_at' | 'failure_summary'>;
export interface HashQuarantineIdentity {
  candidateId: string | null; wingetId: string; version: string; architecture: string | null;
  hash: string | null; profile: string | null; summary: string | null | undefined;
}
const same = (a: string | null, b: string | null) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const digest = (a: string | null) => typeof a === 'string' && /^[a-f0-9]{64}$/i.test(a);

/** Display classification only. This never authorizes an installer or a retry. */
export function isExactHashQuarantine(candidate: Candidate | null | undefined, expected: HashQuarantineIdentity, failedResult: boolean) {
  return !!candidate && !failedResult && candidate.id === expected.candidateId
    && candidate.status === 'superseded' && candidate.phase === 'preparing_package'
    && candidate.github_run_id === null && candidate.started_at === null
    && typeof expected.summary === 'string' && expected.summary.startsWith(HASH_QUARANTINE_PREFIX)
    && candidate.failure_summary === expected.summary && same(candidate.winget_id, expected.wingetId)
    && candidate.version === expected.version && same(candidate.architecture, expected.architecture)
    && digest(expected.hash) && same(candidate.installer_sha256, expected.hash)
    && digest(expected.profile) && digest(candidate.package_profile_sha256)
    && same(candidate.package_profile_sha256, expected.profile);
}

/** Read the exact candidate and result. Callers retain their existing fallback on errors. */
export async function loadHashQuarantine(client: SupabaseClient<Database>, expected: HashQuarantineIdentity): Promise<boolean> {
  if (!expected.candidateId || !expected.summary?.startsWith(HASH_QUARANTINE_PREFIX)) return false;
  const candidate = await client.from('qa_candidates')
    .select('id,winget_id,version,architecture,installer_sha256,package_profile_sha256,status,phase,github_run_id,started_at,failure_summary')
    .eq('id', expected.candidateId).maybeSingle();
  if (candidate.error) throw candidate.error;
  if (!isExactHashQuarantine(candidate.data, expected, false)) return false;
  const row = candidate.data!;
  const result = await client.from('qa_package_results').select('outcome')
    .ilike('package_profile_sha256', row.package_profile_sha256!)
    .ilike('winget_id', row.winget_id).eq('tested_version', row.version)
    .ilike('architecture', row.architecture).ilike('installer_sha256', row.installer_sha256).maybeSingle();
  if (result.error) throw result.error;
  return result.data?.outcome !== 'Failed';
}
