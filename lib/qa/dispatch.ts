import { getGitHubActionsConfig } from '@/lib/github-actions';
import { enforceInstallerPreflight } from '@/lib/installer-preflight';
import { buildQaCandidatePreflightRequest } from '@/lib/qa/candidate-preflight';
import { recordPublicSubmissionIntent } from '@/lib/qa/submission-intent';
import type { Json } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface QaDispatchCandidate {
  id: string;
  winget_id: string;
  definition_path: string | null;
  version: string;
  architecture: string;
  installer_url: string;
  installer_sha256: string;
  installer_file_name: string;
  installer_type: string;
  test_level: 'installer-preflight' | 'psadt-package';
  package_profile_sha256: string | null;
  test_config: Json;
}

const DEFAULT_QA_COMMAND_TIMEOUT_MINUTES = 20;
const REVIEWED_INSTALL_TIMEOUT_HEADROOM_MINUTES = 5;

/** One fixed, expiring scan-only entry point. The caller has exhausted both fair queues. */
export async function dispatchReaderStaticScan(supabase: SupabaseClient): Promise<boolean> {
  const cutoff = Date.parse('2026-11-11T21:00:00Z');
  const since = '2026-11-11T00:00:00Z';
  const id = 'de979d31-562f-40ef-9dd1-3752fa091953';
  const sha256 = '7bec66953457f6bc78bce9f0a1dcdde1c4cf2a8f8ac26f73fcecf5738f42f307';
  if (Date.now() >= cutoff) return false;
  try {
    const candidate = await supabase.from('qa_candidates')
      .select('id,status,winget_id,version,architecture,test_level,installer_sha256,installer_url,package_profile_sha256')
      .eq('id', id).maybeSingle();
    const c = candidate.data;
    if (candidate.error || !c || c.id !== id || c.status !== 'queued' ||
      c.winget_id !== 'Adobe.Acrobat.Reader.64-bit' || c.version !== '26.003.22075' ||
      c.architecture !== 'x64' || c.test_level !== 'psadt-package' ||
      typeof c.installer_sha256 !== 'string' || c.installer_sha256.toLowerCase() !== sha256 ||
      c.installer_url !== 'https://ardownload2.adobe.com/pub/adobe/acrobat/win/AcrobatDC/2600322075/AcroRdrDCx642600322075_MUI.exe' ||
      typeof c.package_profile_sha256 !== 'string' ||
      c.package_profile_sha256.toUpperCase() !== 'BE9876C429C9ADB461675ADC80E58E7890A7F5F41C26275BDD3DDA694C48CDCA') return false;
    const hold = await supabase.from('qa_installer_security_holds')
      .select('malicious_verdicts,released_at').eq('sha256', sha256).maybeSingle();
    if (hold.error || !hold.data || hold.data.released_at !== null || hold.data.malicious_verdicts !== 0) return false;
    const ledger = await supabase.from('qa_vt_requests').select('id')
      .eq('sha256', sha256).eq('operation', 'hash_lookup').eq('candidate_id', id)
      .is('recheck_lease', null).gte('reserved_at', since).limit(1);
    if (ledger.error || !Array.isArray(ledger.data) || ledger.data.length !== 0) return false;

    const config = getGitHubActionsConfig();
    if (config.owner !== 'ugurkocde' || config.workflowsRepo !== 'IntuneGet-Workflows' || config.ref !== 'main') return false;
    const url = 'https://api.github.com/repos/ugurkocde/IntuneGet-Workflows/actions/workflows/intune-qa.yml';
    const headers = { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' };
    let seen = 0;
    let complete = false;
    for (let page = 1; page <= 10; page++) {
      const response = await fetch(`${url}/runs?created=${encodeURIComponent(`>=${since}`)}&per_page=100&page=${page}`, {
        method: 'GET', headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return false;
      const payload = await response.json() as { total_count?: unknown; workflow_runs?: unknown };
      if (!Number.isSafeInteger(payload.total_count) || typeof payload.total_count !== 'number' ||
        payload.total_count < 0 || payload.total_count > 1000 || !Array.isArray(payload.workflow_runs)) return false;
      const runs: unknown[] = payload.workflow_runs;
      if (runs.length > 100 || runs.some(run => !run || typeof run !== 'object' ||
        !('display_title' in run) || typeof run.display_title !== 'string' ||
        !('created_at' in run) || typeof run.created_at !== 'string' ||
        !Number.isFinite(Date.parse(run.created_at)) || Date.parse(run.created_at) < Date.parse(since))) return false;
      if (runs.some(run => (run as { display_title: string }).display_title === 'Reader static scan-only')) return false;
      seen += runs.length;
      if (seen > payload.total_count) return false;
      if (seen === payload.total_count) { complete = true; break; }
      if (runs.length !== 100) return false;
    }
    if (!complete || Date.now() >= cutoff) return false;
    const response = await fetch(`${url}/dispatches`, {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ ref: 'main', inputs: {
        smoke_test: 'false', candidate_label: 'Reader static scan-only', reader_static_scan: 'true',
      } }),
    });
    return response.status === 204;
  } catch {
    // An unavailable binding/history/credential never authorizes a scan or affects ordinary work.
    return false;
  }
}

function qaCommandTimeoutMinutes(
  testConfig: Record<string, Json | undefined>
): number {
  const psadtConfig = testConfig.psadtConfig;
  if (!psadtConfig || typeof psadtConfig !== 'object' || Array.isArray(psadtConfig)) {
    return DEFAULT_QA_COMMAND_TIMEOUT_MINUTES;
  }

  const reviewedTimeout = psadtConfig.reviewedInstallCompletionTimeoutMinutes;
  if (
    typeof reviewedTimeout !== 'number' ||
    !Number.isInteger(reviewedTimeout) ||
    reviewedTimeout < 1 ||
    reviewedTimeout > 60
  ) {
    return DEFAULT_QA_COMMAND_TIMEOUT_MINUTES;
  }

  // The generated customer package owns the reviewed installer deadline. Keep
  // the outer QA command guard beyond it so PSADT can report its bounded result
  // and perform teardown instead of QA terminating a still-valid installer.
  return Math.max(
    DEFAULT_QA_COMMAND_TIMEOUT_MINUTES,
    reviewedTimeout + REVIEWED_INSTALL_TIMEOUT_HEADROOM_MINUTES
  );
}

export async function dispatchQaCandidate(candidate: QaDispatchCandidate): Promise<void> {
  const testConfig = candidate.test_config && typeof candidate.test_config === 'object' && !Array.isArray(candidate.test_config)
    ? candidate.test_config as Record<string, Json | undefined>
    : {};
  const preflightRequest = buildQaCandidatePreflightRequest(candidate);
  const executionInstallerUrl = preflightRequest.installerUrl;

  // Keep the QA dispatch boundary aligned with customer packaging. A vendor
  // can replace the bytes behind a mutable URL after WinGet publishes its
  // manifest. Verify the exact URL/hash tuple before consuming the runner so
  // QA never tests bytes that a customer upload would reject.
  const preflight = await enforceInstallerPreflight(preflightRequest);
  await recordPublicSubmissionIntent(candidate.id, candidate.test_level, preflightRequest, preflight);

  const config = getGitHubActionsConfig();
  const url = `https://api.github.com/repos/${config.owner}/${config.workflowsRepo}/actions/workflows/intune-qa.yml/dispatches`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      ref: config.ref,
      inputs: {
        smoke_test: 'false',
        candidate_label: `${candidate.winget_id} ${candidate.version} ${candidate.architecture}`,
        app_definition: candidate.definition_path || '',
        candidate_payload: JSON.stringify({
          id: candidate.id,
          wingetId: candidate.winget_id,
          version: candidate.version,
          architecture: candidate.architecture,
          installerUrl: executionInstallerUrl,
          installerSha256: candidate.installer_sha256,
          installerFileName: candidate.installer_file_name,
          installerType: candidate.installer_type,
          testLevel: candidate.test_level,
          packageProfileSha256: candidate.package_profile_sha256,
          testConfig: candidate.test_config,
        }),
        timeout_minutes: String(qaCommandTimeoutMinutes(testConfig)),
      },
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`QA workflow dispatch failed (${response.status}): ${detail}`);
  }
}
