import { getGitHubActionsConfig } from '@/lib/github-actions';

export interface QaDispatchCandidate {
  id: string;
  definition_path: string;
  version: string;
  installer_url: string;
  installer_sha256: string;
  installer_file_name: string;
  installer_type: string;
}

export async function dispatchQaCandidate(candidate: QaDispatchCandidate): Promise<void> {
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
        app_definition: candidate.definition_path,
        candidate_payload: JSON.stringify({
          id: candidate.id,
          version: candidate.version,
          installerUrl: candidate.installer_url,
          installerSha256: candidate.installer_sha256,
          installerFileName: candidate.installer_file_name,
          installerType: candidate.installer_type,
        }),
        timeout_minutes: '60',
      },
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`QA workflow dispatch failed (${response.status}): ${detail}`);
  }
}
