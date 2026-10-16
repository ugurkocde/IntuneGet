import type { InstallerPreflightRequest, InstallerPreflightResult } from '@/lib/installer-preflight';
import { getServerClientOrNull } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Optional provenance API: failure grants no upload rights and never blocks dispatch. */
export async function recordPublicSubmissionIntent(
  candidateId: string,
  testLevel: string,
  request: InstallerPreflightRequest,
  preflight: InstallerPreflightResult | undefined,
): Promise<void> {
  if (testLevel !== 'psadt-package' || request.sourceType !== 'winget'
    || /^(custom\.|intuneget\.curated\.)/i.test(request.wingetId)
    || preflight?.status !== 'healthy' || !['live', 'cache'].includes(preflight.source)
    || !preflight.cacheKey) return;
  try {
    const client = getServerClientOrNull() as SupabaseClient | null;
    if (!client) return;
    const { error } = await client.rpc('record_qa_vt_submission_intent', {
      p_candidate_id: candidateId, p_cache_key: preflight.cacheKey,
      p_execution_url: request.installerUrl,
    });
    if (error) throw new Error('Submission intent unavailable');
  } catch {
    // Do not log transport errors, URLs or customer configuration.
    console.warn('QA public installer submission intent unavailable');
  }
}
