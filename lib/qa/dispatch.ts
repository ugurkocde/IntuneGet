import { getGitHubActionsConfig } from '@/lib/github-actions';
import { enforceInstallerPreflight } from '@/lib/installer-preflight';
import { buildQaCandidatePreflightRequest } from '@/lib/qa/candidate-preflight';
import type { Json } from '@/types/database';

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
  await enforceInstallerPreflight(preflightRequest);

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
