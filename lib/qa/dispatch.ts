import { getGitHubActionsConfig } from '@/lib/github-actions';
import { enforceInstallerPreflight } from '@/lib/installer-preflight';
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

export async function dispatchQaCandidate(candidate: QaDispatchCandidate): Promise<void> {
  const testConfig = candidate.test_config && typeof candidate.test_config === 'object' && !Array.isArray(candidate.test_config)
    ? candidate.test_config as Record<string, Json | undefined>
    : {};
  const installScope = testConfig.scope === 'user' ? 'user' : 'machine';

  // Keep the QA dispatch boundary aligned with customer packaging. A vendor
  // can replace the bytes behind a mutable URL after WinGet publishes its
  // manifest. Verify the exact URL/hash tuple before consuming the runner so
  // QA never tests bytes that a customer upload would reject.
  await enforceInstallerPreflight({
    wingetId: candidate.winget_id,
    version: candidate.version,
    architecture: candidate.architecture,
    installerUrl: candidate.installer_url,
    installerSha256: candidate.installer_sha256,
    installerType: candidate.installer_type,
    installScope,
    sourceType: 'winget',
  });

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
          installerUrl: candidate.installer_url,
          installerSha256: candidate.installer_sha256,
          installerFileName: candidate.installer_file_name,
          installerType: candidate.installer_type,
          testLevel: candidate.test_level,
          packageProfileSha256: candidate.package_profile_sha256,
          testConfig: candidate.test_config,
        }),
        timeout_minutes: '20',
      },
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`QA workflow dispatch failed (${response.status}): ${detail}`);
  }
}
