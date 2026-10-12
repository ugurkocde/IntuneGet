import { createServerClient } from '@/lib/supabase';
import type { CuratedQaRun } from '@/types/qa';

const MAX_RESULTS = 30;
// Public fields only: no tenant identity, PSADT configuration, commands or
// private QA repository links. Failure text is already redacted by the verifier.
const COLUMNS = 'github_run_id,github_run_attempt,kind,winget_id,display_name,tested_version,architecture,outcome,tested_at_utc,upgrade_tested,upgrade_from_version,signature_status,signer,defender_status,failed_step,failed_message';

export async function getCuratedQaHistory(limit = 20): Promise<CuratedQaRun[]> {
  const { data, error } = await createServerClient()
    .from('curated_qa_runs')
    .select(COLUMNS)
    .order('tested_at_utc', { ascending: false })
    .limit(Math.min(Math.max(1, limit), MAX_RESULTS));
  if (error) throw new Error('Curated QA history is unavailable.');
  return (data || []).map(row => ({
    runId: `${row.github_run_id}:${row.github_run_attempt}`,
    kind: row.kind,
    wingetId: row.winget_id,
    displayName: row.display_name,
    testedVersion: row.tested_version,
    architecture: row.architecture,
    outcome: row.outcome,
    testedAtUtc: row.tested_at_utc,
    upgradeTested: row.upgrade_tested,
    upgradeFromVersion: row.upgrade_from_version,
    signatureStatus: row.signature_status,
    signer: row.signer,
    defenderStatus: row.defender_status,
    failedStep: row.outcome === 'Failed' ? row.failed_step : null,
    failedMessage: row.outcome === 'Failed' ? row.failed_message : null,
  }));
}
