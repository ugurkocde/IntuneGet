/**
 * Azure DevOps Client
 * Handles triggering packaging pipelines via Azure DevOps REST API
 */

export interface PipelineRunRequest {
  jobId: string;
  callbackUrl: string;
  wingetId: string;
  displayName: string;
  publisher: string;
  version: string;
  installerUrl: string;
  installerSha256: string;
  installerType: string;
  silentSwitches: string;
  uninstallCommand: string;
  installScope: 'machine' | 'user';
}

export interface PipelineRunResponse {
  id: number;
  url: string;
  state: string;
  result?: string;
  createdDate: string;
}

export interface AzureDevOpsConfig {
  organization: string;
  project: string;
  pipelineId: number;
  personalAccessToken: string;
}

/**
 * Get Azure DevOps configuration from environment variables
 */
export function getAzureDevOpsConfig(): AzureDevOpsConfig {
  const organization = process.env.AZURE_DEVOPS_ORGANIZATION;
  const project = process.env.AZURE_DEVOPS_PROJECT;
  const pipelineId = process.env.AZURE_DEVOPS_PIPELINE_ID;
  const personalAccessToken = process.env.AZURE_DEVOPS_PAT;

  if (!organization || !project || !pipelineId || !personalAccessToken) {
    throw new Error(
      'Missing Azure DevOps configuration. Required: AZURE_DEVOPS_ORGANIZATION, AZURE_DEVOPS_PROJECT, AZURE_DEVOPS_PIPELINE_ID, AZURE_DEVOPS_PAT'
    );
  }

  return {
    organization,
    project,
    pipelineId: parseInt(pipelineId, 10),
    personalAccessToken,
  };
}

/**
 * Trigger an Azure DevOps pipeline run
 */
export async function triggerPipelineRun(
  config: AzureDevOpsConfig,
  request: PipelineRunRequest
): Promise<PipelineRunResponse> {
  const url = `https://dev.azure.com/${config.organization}/${config.project}/_apis/pipelines/${config.pipelineId}/runs?api-version=7.1`;

  // Create Basic auth header
  const authHeader = Buffer.from(`:${config.personalAccessToken}`).toString('base64');

  const body = {
    // Template parameters are passed differently in Azure DevOps
    templateParameters: {
      jobId: request.jobId,
      callbackUrl: request.callbackUrl,
      wingetId: request.wingetId,
      displayName: request.displayName,
      publisher: request.publisher,
      version: request.version,
      installerUrl: request.installerUrl,
      installerSha256: request.installerSha256,
      installerType: request.installerType,
      silentSwitches: request.silentSwitches,
      uninstallCommand: request.uninstallCommand,
      installScope: request.installScope,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${authHeader}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to trigger pipeline: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const data = await response.json();

  return {
    id: data.id,
    url: data._links?.web?.href || `https://dev.azure.com/${config.organization}/${config.project}/_build/results?buildId=${data.id}`,
    state: data.state,
    result: data.result,
    createdDate: data.createdDate,
  };
}

/**
 * Get the status of a pipeline run
 */
export async function getPipelineRunStatus(
  config: AzureDevOpsConfig,
  runId: number
): Promise<PipelineRunResponse> {
  const url = `https://dev.azure.com/${config.organization}/${config.project}/_apis/pipelines/${config.pipelineId}/runs/${runId}?api-version=7.1`;

  const authHeader = Buffer.from(`:${config.personalAccessToken}`).toString('base64');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${authHeader}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get pipeline status: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  return {
    id: data.id,
    url: data._links?.web?.href || `https://dev.azure.com/${config.organization}/${config.project}/_build/results?buildId=${data.id}`,
    state: data.state,
    result: data.result,
    createdDate: data.createdDate,
  };
}

/**
 * Cancel a pipeline run
 */
export async function cancelPipelineRun(
  config: AzureDevOpsConfig,
  runId: number
): Promise<void> {
  // To cancel, we need to use the build API
  const url = `https://dev.azure.com/${config.organization}/${config.project}/_apis/build/builds/${runId}?api-version=7.1`;

  const authHeader = Buffer.from(`:${config.personalAccessToken}`).toString('base64');

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${authHeader}`,
    },
    body: JSON.stringify({
      status: 'cancelling',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to cancel pipeline: ${response.status} ${response.statusText}`);
  }
}

/**
 * Map pipeline state to our job status
 */
export function mapPipelineStateToJobStatus(
  state: string,
  result?: string
): 'queued' | 'packaging' | 'completed' | 'failed' {
  // Azure DevOps states: unknown, canceling, completed, inProgress, notStarted
  // Azure DevOps results: canceled, failed, succeeded

  if (state === 'notStarted') return 'queued';
  if (state === 'inProgress') return 'packaging';
  if (state === 'completed') {
    if (result === 'succeeded') return 'completed';
    return 'failed';
  }
  if (state === 'canceling') return 'failed';

  return 'packaging';
}
