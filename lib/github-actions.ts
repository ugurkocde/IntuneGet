import type { PackagingWorkflowRun, WorkflowAttemptJobs } from './runner-loss';
import { isExactPackagingRun } from './runner-loss';
/**
 * GitHub Actions Client
 * Triggers packaging workflows via GitHub REST API
 * Uses repository_dispatch to a private workflows repository
 */

import { createHash, createHmac } from 'node:crypto';
import { dispatchRateLimitError, WorkflowDispatchUnconfirmedError } from './workflow-dispatch-rate-limit';
import { CuratedCatalogError, isCuratedPackageId } from '@/lib/curated-catalog/core.mjs';
import { authorizeCuratedWorkflow } from '@/lib/curated-catalog/server';
import { assertCuratedLicenceAccepted } from '@/lib/curated-catalog/licence';

import { applyInstallerUrlOverride } from './installer-url-overrides';
import { reconcileCatalogInstaller } from './catalog-installer-reconciliation';
import { enforceInstallerPreflight, InstallerPreflightError } from './installer-preflight';
import { enforceQaGate } from './qa/gate';
import {
  resolveApplicationInstallScope,
  resolveApplicationInstallerSuccessCodes,
  resolveApplicationUninstallCommand,
} from './packaging-adapters';
import { assertPackagingContract } from './packaging-contract';
import {
  normalizeQaWorkflowPackageInput,
  canonicalQaJson,
} from './qa/package-profile';
import {
  resolveWingetPackageDependencies,
  type PackagedWingetDependency,
} from './winget-dependencies';
import type { Win32CartItem } from '@/types/upload';
import type { NormalizedInstaller } from '@/types/winget';

export interface WorkflowInputs {
  jobId: string;
  tenantId: string;
  wingetId: string;
  displayName: string;
  description?: string;
  publisher: string;
  version: string;
  architecture?: string;
  installerUrl: string;
  installerSha256: string;
  hashValidationMode?: 'strict' | 'calculate';
  installerType: string;
  nestedInstallerType?: string; // Nested installer type for zip installers
  nestedInstallerPath?: string; // Relative path to the nested installer inside the zip
  silentSwitches: string;
  installerSuccessCodes?: number[];
  uninstallCommand: string;
  callbackUrl: string;
  psadtConfig?: string; // JSON-serialized PSADTConfig
  detectionRules?: string; // JSON-serialized DetectionRule[]
  requirementRules?: string; // JSON-serialized RequirementRule[]
  assignments?: string; // JSON-serialized PackageAssignment[]
  categories?: string; // JSON-serialized IntuneAppCategorySelection[]
  espProfiles?: string; // JSON-serialized EspProfileSelection[]
  relationships?: string; // JSON-serialized AppRelationship[]
  installScope?: 'machine' | 'user'; // Install scope for per-user vs per-machine
  forceCreate?: boolean; // Skip duplicate check and force create new app
  qaOverride?: boolean; // Server-side QA acknowledgement; never forwarded to GitHub
  sourceIntuneAppId?: string; // Previous app ID for assignment carry-over
  carryOverAssignments?: boolean; // Copy assignments from previous app
  removeAssignmentsFromPreviousApp?: boolean; // Remove assignments from previous app after carry-over
  autoSupersede?: boolean; // Mark the new app as superseding the previous app
  supersedenceType?: string; // Supersedence type for auto-supersede ('update' | 'replace')
  sourceType?: 'winget' | 'custom' | 'curated';
  curatedReleaseId?: string;
  packageProfileSha256?: string; // Upstream QA identity; final dispatch recalculates from effective inputs
  packageDependencies?: PackagedWingetDependency[]; // Server-resolved; caller values are never trusted
}

export interface GitHubActionsConfig {
  token: string;
  owner: string;
  repo: string; // Public repo (for reference)
  workflowsRepo: string; // Private repo for workflows
  workflowFile: string;
  ref: string;
}

/**
 * Get GitHub Actions configuration from environment variables
 */
export function getGitHubActionsConfig(): GitHubActionsConfig {
  const token = process.env.GITHUB_PAT;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const workflowsRepo = process.env.GITHUB_WORKFLOWS_REPO;
  const workflowFile = process.env.GITHUB_WORKFLOW_FILE || 'package-intunewin.yml';
  const ref = process.env.GITHUB_REF || 'main';

  if (!token) {
    throw new Error('GITHUB_PAT environment variable is not set');
  }
  if (!owner) {
    throw new Error('GITHUB_OWNER environment variable is not set');
  }
  if (!workflowsRepo) {
    throw new Error('GITHUB_WORKFLOWS_REPO environment variable is not set');
  }

  return { token, owner, repo: repo || '', workflowsRepo, workflowFile, ref };
}

/**
 * Check if GitHub Actions is configured
 */
export function isGitHubActionsConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_PAT &&
    process.env.GITHUB_OWNER &&
    process.env.GITHUB_WORKFLOWS_REPO
  );
}

export interface TriggerResult {
  success: boolean;
  runId?: number;
  runUrl?: string;
}

/**
 * Trigger the packaging workflow via repository_dispatch to private workflows repo
 * Returns the workflow run ID if it can be captured
 *
 * @param skipRunCapture - When true, skip the run ID polling and return immediately.
 *   Useful for batch dispatches where concurrent triggers make polling unreliable.
 */
export async function triggerPackagingWorkflow(
  inputs: WorkflowInputs,
  config?: GitHubActionsConfig,
  options?: { skipRunCapture?: boolean; requireQaPass?: boolean;
    newJobAdmission?: boolean; beforeDispatch?: (identity: string) => Promise<void> }
): Promise<TriggerResult> {
  const cfg = config || getGitHubActionsConfig();

  let effectiveInputs = inputs;
  let trustedInstallers: NormalizedInstaller[] | undefined;
  if (isCuratedPackageId(inputs.wingetId) || inputs.sourceType === 'curated') {
    if (inputs.sourceType === 'custom' || inputs.qaOverride || inputs.hashValidationMode === 'calculate') {
      throw new CuratedCatalogError('Curated releases require their approved validation profile.');
    }
    const approved = await authorizeCuratedWorkflow(inputs);
    // Every hosted dispatch (cart, QA resume, manual and automatic updates,
    // MSP batches) passes here, so the target tenant's licence acceptance is
    // enforced for each one regardless of how the job was created.
    await assertCuratedLicenceAccepted(inputs.tenantId, approved.app.packageId);
    effectiveInputs = { ...inputs, sourceType: 'curated', curatedReleaseId: approved.release.id };
    trustedInstallers = [approved.installer];
  } else if (inputs.sourceType !== 'custom') {
    const resolvedUninstallCommand = resolveApplicationUninstallCommand(
      inputs.wingetId,
      inputs.uninstallCommand,
    );
    const generatedDisplayUninstallCommand = resolveApplicationUninstallCommand(
      inputs.wingetId,
      `REGISTRY_UNINSTALL:${inputs.displayName}`,
    );
    // Generated catalog fallbacks are not customer overrides. Let trusted
    // manifest reconciliation replace them with a ProductCode, exact ARP key
    // or MSIX package identity; preserve real custom uninstall commands.
    const customerUninstallOverride = resolvedUninstallCommand.trim() &&
      resolvedUninstallCommand.trim() !== generatedDisplayUninstallCommand
      && resolvedUninstallCommand.trim() !== 'MSIX_UNINSTALL:{PACKAGE_NAME}'
      ? resolvedUninstallCommand
      : undefined;
    try {
      const reconciled = await reconcileCatalogInstaller({
        id: inputs.jobId,
        addedAt: new Date().toISOString(),
        appSource: 'win32',
        sourceType: 'winget',
        wingetId: inputs.wingetId,
        displayName: inputs.displayName,
        description: inputs.description,
        publisher: inputs.publisher,
        version: inputs.version,
        architecture: (inputs.architecture || 'x64') as Win32CartItem['architecture'],
        installScope: inputs.installScope || 'machine',
        installerType: inputs.installerType as Win32CartItem['installerType'],
        installerUrl: inputs.installerUrl,
        installerSha256: inputs.installerSha256,
        installerSuccessCodes: inputs.installerSuccessCodes,
        installCommand: inputs.silentSwitches,
        uninstallCommand: inputs.uninstallCommand,
        detectionRules: [],
        requirementRules: [],
        psadtConfig: {
          installCommand: inputs.silentSwitches,
          uninstallCommand: customerUninstallOverride,
        } as Win32CartItem['psadtConfig'],
      });
      effectiveInputs = {
        ...inputs,
        installerUrl: reconciled.item.installerUrl,
        installerSha256: reconciled.item.installerSha256,
        installerType: reconciled.item.installerType,
        nestedInstallerType: reconciled.item.nestedInstallerType,
        nestedInstallerPath: reconciled.item.nestedInstallerPath,
        silentSwitches: reconciled.item.installCommand,
        installerSuccessCodes: reconciled.item.installerSuccessCodes,
        uninstallCommand: reconciled.item.uninstallCommand,
        installScope: reconciled.item.installScope,
      };
      trustedInstallers = reconciled.trustedInstallers;
    } catch (error) {
      if (!(error instanceof InstallerPreflightError && error.retryable)) {
        throw error;
      }
      console.warn(`Live installer reconciliation unavailable for ${inputs.wingetId} ${inputs.version}; using the catalog tuple.`);
    }
  }

  const finalInstallerUrl = applyInstallerUrlOverride(
    effectiveInputs.wingetId,
    effectiveInputs.version,
    effectiveInputs.architecture ?? '',
    effectiveInputs.installerUrl,
  );
  // This is the final dispatch boundary shared by manual, MSP, update-policy,
  // and auto-update paths. Never create a packaging run for a known-bad tuple.
  await enforceInstallerPreflight({
    wingetId: effectiveInputs.wingetId,
    version: effectiveInputs.version,
    architecture: effectiveInputs.architecture,
    installerUrl: finalInstallerUrl,
    manifestInstallerUrl: effectiveInputs.installerUrl,
    installerSha256: effectiveInputs.installerSha256,
    installerType: effectiveInputs.installerType,
    installScope: effectiveInputs.installScope,
    sourceType: effectiveInputs.sourceType,
    curatedReleaseId: effectiveInputs.curatedReleaseId,
  }, trustedInstallers);
  inputs = effectiveInputs.sourceType === 'custom'
    ? effectiveInputs
    : {
        ...effectiveInputs,
        installScope: resolveApplicationInstallScope(
          effectiveInputs.wingetId,
          effectiveInputs.installScope
        ),
        installerSuccessCodes: resolveApplicationInstallerSuccessCodes(
          effectiveInputs.wingetId,
          effectiveInputs.installerSuccessCodes
        ),
      };
  // Final dispatch boundary: custom callers bypass catalog reconciliation, so
  // they must still prove an unattended install contract before GitHub sees
  // the installer URL or any tenant-scoped packaging request.
  assertPackagingContract({
    wingetId: inputs.wingetId,
    installerType: inputs.installerType,
    silentArgs: inputs.silentSwitches,
    nestedInstallerType: inputs.nestedInstallerType,
    nestedInstallerFiles: inputs.nestedInstallerPath ? [inputs.nestedInstallerPath] : [],
  });
  const packageDependencies = inputs.sourceType === 'custom'
    ? []
    : await resolveWingetPackageDependencies({
        wingetId: inputs.wingetId,
        version: inputs.version,
        architecture: inputs.architecture,
        installerSha256: inputs.installerSha256,
        installScope: inputs.installScope,
      });
  const normalizedPackageInput = inputs.sourceType === 'custom'
    ? null
    : normalizeQaWorkflowPackageInput({ ...inputs, packageDependencies });
  // Keep the workflow payload and its hashed execution profile identical even
  // when live catalog reconciliation is temporarily unavailable. Reviewed app
  // identities are resolved again by normalizeQaWorkflowPackageInput; dispatch
  // that exact command so the customer PSADT package cannot retain stale
  // manifest metadata while its QA gate evaluates the corrected profile.
  if (normalizedPackageInput) {
    inputs = {
      ...inputs,
      uninstallCommand: normalizedPackageInput.uninstallCommand,
    };
  }
  const packageDependenciesJson = JSON.stringify(packageDependencies);
  const dependencyBundleSignature = packageDependencies.length > 0
    ? (() => {
        const callbackSecret = process.env.CALLBACK_SECRET;
        if (!callbackSecret) {
          throw new Error('CALLBACK_SECRET is required to sign package dependencies.');
        }
        return createHmac('sha256', callbackSecret)
          .update(packageDependenciesJson, 'utf8')
          .digest('hex');
      })()
    : '';
  const calculatedPackageProfileSha256 = normalizedPackageInput?.identity.packageProfileSha256;
  const packageProfileSha256 = calculatedPackageProfileSha256;
  await enforceQaGate({
    wingetId: inputs.wingetId,
    version: inputs.version,
    architecture: inputs.architecture,
    installerSha256: inputs.installerSha256,
    packageProfileSha256,
    resolvedPackageDependencies: packageDependencies,
    requirePassed: options?.requireQaPass,
    qaOverride: inputs.qaOverride,
    sourceType: inputs.sourceType,
    curatedReleaseId: inputs.curatedReleaseId,
  });

  // Record time before triggering to help find the run
  const triggerTime = new Date();

  // Use repository_dispatch to trigger workflow in private repo
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.workflowsRepo}/dispatches`;

  // Hash and send the same final payload. Credential-derived signatures are
  // excluded from the stored identity; job and tenant bindings stay included.
  const payload = {
      event_type: 'package-app',
      client_payload: {
        job: {
          jobId: inputs.jobId,
          tenantId: inputs.tenantId,
          callbackUrl: inputs.callbackUrl,
        },
        app: {
          wingetId: inputs.wingetId,
          displayName: inputs.displayName,
          description: inputs.description,
          publisher: inputs.publisher,
          version: inputs.version,
          architecture: inputs.architecture,
        },
        installer: {
          url: finalInstallerUrl,
          sha256: inputs.installerSha256,
          hashValidationMode: inputs.hashValidationMode || 'strict',
          type: inputs.installerType,
          nestedInstallerType: inputs.nestedInstallerType || '',
          nestedInstallerPath: inputs.nestedInstallerPath || '',
          silentSwitches: inputs.silentSwitches,
          successCodes: JSON.stringify(inputs.installerSuccessCodes || []),
          packageDependencies: packageDependenciesJson,
          dependencyBundleSignature,
          uninstallCommand: inputs.uninstallCommand,
        },
        config: {
          psadtConfig: normalizedPackageInput?.psadtConfigJson || inputs.psadtConfig || '{}',
          detectionRules:
            normalizedPackageInput?.detectionRulesJson || inputs.detectionRules || '[]',
          requirementRules: inputs.requirementRules || '[]',
          assignments: inputs.assignments || '[]',
          categories: inputs.categories || '[]',
          espProfiles: inputs.espProfiles || '[]',
          relationships: inputs.relationships || '[]',
          installScope: inputs.installScope || 'machine',
          forceCreate: inputs.forceCreate ? 'true' : 'false',
          sourceIntuneAppId: inputs.sourceIntuneAppId || '',
          carryOverAssignments: inputs.carryOverAssignments ? 'true' : 'false',
          removeAssignmentsFromPreviousApp: inputs.removeAssignmentsFromPreviousApp ? 'true' : 'false',
          autoSupersede: inputs.autoSupersede ? 'true' : 'false',
          supersedenceType: inputs.supersedenceType || '',
        },
      },
  };
  const dispatchIdentity = createHash('sha256').update(canonicalQaJson({
    payload: { ...payload, client_payload: { ...payload.client_payload,
      installer: { ...payload.client_payload.installer, dependencyBundleSignature: undefined } } },
    packageProfileSha256: packageProfileSha256 ?? null,
    curatedReleaseId: inputs.curatedReleaseId ?? null,
  })).digest('hex');
  await options?.beforeDispatch?.(dispatchIdentity);
  const newAdmissionIdentity = options?.newJobAdmission && inputs.sourceType !== 'custom' ? dispatchIdentity : undefined;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(payload),
  }).catch(() => { throw new WorkflowDispatchUnconfirmedError(null, Date.now(), newAdmissionIdentity); });

  if (!response.ok) {
    if (response.status >= 500) throw new WorkflowDispatchUnconfirmedError(response.status, Date.now(), newAdmissionIdentity);
    const errorText = await response.text();
    const rateLimit = dispatchRateLimitError(response, errorText);
    if (rateLimit) throw rateLimit;
    throw new Error(
      `Failed to trigger GitHub Actions workflow: HTTP ${response.status}`
    );
  }

  // repository_dispatch returns 204 No Content on success
  if (options?.skipRunCapture) {
    return { success: true };
  }

  // Try to capture the run ID by polling recent runs in the private repo
  const runInfo = await captureWorkflowRunId(inputs.jobId, triggerTime, cfg);

  return {
    success: true,
    runId: runInfo?.id,
    runUrl: runInfo?.html_url,
  };
}

/**
 * Attempt to capture the workflow run ID after triggering
 * Capture only an exact job identity emitted by the packaging workflow.
 * Time alone cannot distinguish concurrent dispatches, including runs whose
 * runner never starts and therefore never sends a correcting callback.
 */
async function captureWorkflowRunId(
  jobId: string,
  triggerTime: Date,
  config: GitHubActionsConfig,
  maxAttempts: number = 5,
  delayMs: number = 2000
): Promise<{ id: number; html_url: string } | null> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(jobId)) return null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Wait before checking (workflow takes time to appear)
    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      const query = {
        workflowFile: config.workflowFile, branch: config.ref,
        event: 'repository_dispatch',
        created: `>=${new Date(triggerTime.getTime() - 30_000).toISOString()}`,
        per_page: 100,
      };
      const first = await getWorkflowRuns(config, query);
      if (!Number.isSafeInteger(first.total_count) || first.total_count < 0 || first.total_count > 200) continue;
      let candidates = first.workflow_runs;
      if (first.total_count > candidates.length) {
        if (candidates.length !== 100) continue;
        const second = await getWorkflowRuns(config, { ...query, page: 2 });
        if (second.total_count !== first.total_count) continue;
        candidates = [...candidates, ...second.workflow_runs];
      }
      // A changing or truncated page set cannot establish a unique identity.
      if (candidates.length !== first.total_count) continue;
      const matches = candidates.filter(run => {
        const createdAt = Date.parse(run.created_at);
        return Number.isSafeInteger(run.id) && run.id > 0
          && run.display_title === `Package ${jobId}`
          && run.event === 'repository_dispatch'
          && run.path?.split('@')[0] === `.github/workflows/${config.workflowFile}`
          && run.head_branch === config.ref
          && run.run_attempt === 1
          && Number.isFinite(createdAt)
          && createdAt >= triggerTime.getTime() - 30_000
          && createdAt <= triggerTime.getTime() + 10 * 60_000;
      });
      // Never choose a newest run when the same identity is ambiguous.
      if (matches.length > 1) return null;
      if (matches.length === 1) {
        const run = matches[0];
        return { id: run.id, html_url: `https://github.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.workflowsRepo)}/actions/runs/${run.id}` };
      }
    } catch (error) {
      console.warn(`Failed to capture run ID (attempt ${attempt + 1}):`, error);
    }
  }

  console.warn('Could not capture workflow run ID after multiple attempts');
  return null;
}

/**
 * Get workflow runs from the private workflows repository
 */
export async function getWorkflowRuns(
  config?: GitHubActionsConfig,
  options?: {
    status?: 'queued' | 'in_progress' | 'completed';
    per_page?: number;
    workflowFile?: string;
    branch?: string;
    event?: string;
    created?: string;
    page?: number;
  }
): Promise<{
  total_count: number;
  workflow_runs: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    html_url: string;
    created_at: string;
    updated_at: string;
    display_title?: string;
    event?: string;
    path?: string;
    head_branch?: string;
    run_attempt?: number;
  }>;
}> {
  const cfg = config || getGitHubActionsConfig();
  const params = new URLSearchParams();

  if (options?.status) {
    params.set('status', options.status);
  }
  if (options?.per_page) {
    params.set('per_page', options.per_page.toString());
  }
  for (const key of ['branch', 'event', 'created'] as const) {
    if (options?.[key]) params.set(key, options[key]);
  }
  if (options?.page) params.set('page', options.page.toString());

  // Query the private workflows repository
  const runsPath = options?.workflowFile
    ? `workflows/${encodeURIComponent(options.workflowFile)}/runs` : 'runs';
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.workflowsRepo}/actions/${runsPath}?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get workflow runs: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  return response.json();
}

export interface CancelResult {
  success: boolean;
  status: 'cancelled' | 'not_cancellable' | 'not_found' | 'not_started' | 'error';
  message: string;
}

/**
 * Cancel a workflow run by ID in the private workflows repository
 * Returns success/failure with appropriate handling:
 * - 202: Accepted (cancellation initiated)
 * - 409: Conflict (workflow already completed or not cancellable)
 * - 404: Not found
 *
 * GitHub can leave a dispatched run reported as queued while refusing the
 * normal cancel with 409 ("has not been queued yet"). The force-cancel
 * endpoint is tried once before giving up so such runs are not left behind.
 */
export async function cancelWorkflowRun(
  runId: number | string,
  config?: GitHubActionsConfig
): Promise<CancelResult> {
  const cfg = config || getGitHubActionsConfig();
  // Cancel in private workflows repository
  const runUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.workflowsRepo}/actions/runs/${runId}`;
  const post = (action: 'cancel' | 'force-cancel') => fetch(`${runUrl}/${action}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  try {
    let response = await post('cancel');
    if (response.status === 409) {
      response = await post('force-cancel');
    }

    if (response.status === 202) {
      return {
        success: true,
        status: 'cancelled',
        message: 'Workflow cancellation initiated',
      };
    }

    if (response.status === 409) {
      return {
        success: false,
        status: 'not_cancellable',
        message: 'Workflow has already completed or cannot be cancelled',
      };
    }

    if (response.status === 404) {
      return {
        success: false,
        status: 'not_found',
        message: 'Workflow run not found',
      };
    }

    const errorText = await response.text();
    return {
      success: false,
      status: 'error',
      message: `Failed to cancel workflow: ${response.status} ${response.statusText} - ${errorText}`,
    };
  } catch (error) {
    return {
      success: false,
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error cancelling workflow',
    };
  }
}

/**
 * GitHub run statuses that mean no runner has started executing the run.
 */
export const UNSTARTED_WORKFLOW_RUN_STATUSES = ['queued', 'waiting', 'pending', 'requested'];

/**
 * Get a specific workflow run by ID from the private workflows repository
 */
export async function getWorkflowRun(
  runId: number,
  config?: GitHubActionsConfig,
  timeoutMs = 8_000,
): Promise<PackagingWorkflowRun & {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}> {
  const cfg = config || getGitHubActionsConfig();
  // Get from private workflows repository
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.workflowsRepo}/actions/runs/${runId}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) throwWorkflowReadError(response);

  return response.json();
}

/** A read-side quota refusal stops the entire bounded reconciliation pass. */
export class WorkflowReadRateLimitError extends Error {
  constructor(public retryAfter: string | null, public reset: string | null) {
    super('GitHub workflow evidence is temporarily rate limited');
  }
}

function throwWorkflowReadError(response: Response): never {
  if (response.status === 429 || response.status === 403 &&
    (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'))) {
    throw new WorkflowReadRateLimitError(response.headers.get('retry-after'), response.headers.get('x-ratelimit-reset'));
  }
  throw new Error('GitHub workflow evidence unavailable (HTTP ' + response.status + ')');
}

async function workflowEvidence<T>(suffix: string, config: GitHubActionsConfig, timeoutMs: number): Promise<T> {
  const response = await fetch('https://api.github.com/repos/' + config.owner + '/' + config.workflowsRepo + suffix, {
    headers: { Authorization: 'Bearer ' + config.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throwWorkflowReadError(response);
  return response.json();
}

/** Recover an identity from a complete bounded window, never from time alone. */
export async function findPackagingWorkflowRun(jobId: string, startedAt: string, config: GitHubActionsConfig, timeoutMs = 8_000): Promise<{ id: number } | null> {
  const started = Date.parse(startedAt);
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(jobId) || !Number.isFinite(started)) return null;
  const deadline = Date.now() + Math.max(1, Math.min(timeoutMs, 8_000));
  const query = new URLSearchParams({ branch: config.ref.replace(/^refs\/heads\//, ''), event: 'repository_dispatch',
    created: `${new Date(started - 60_000).toISOString()}..${new Date(started + 10 * 60_000).toISOString()}`, per_page: '100' });
  type Page = { total_count: number; workflow_runs: PackagingWorkflowRun[] };
  const page = (number: number) => workflowEvidence<Page>(`/actions/workflows/${encodeURIComponent(config.workflowFile)}/runs?${query}&page=${number}`, config, Math.max(1, deadline - Date.now()));
  const first = await page(1);
  if (!Number.isSafeInteger(first.total_count) || first.total_count < 0 || first.total_count > 200 || !Array.isArray(first.workflow_runs)) return null;
  let runs = first.workflow_runs;
  if (first.total_count > runs.length) {
    if (runs.length !== 100 || Date.now() >= deadline) return null;
    const second = await page(2);
    if (second.total_count !== first.total_count || !Array.isArray(second.workflow_runs)) return null;
    runs = [...runs, ...second.workflow_runs];
  }
  if (Date.now() >= deadline || runs.length !== first.total_count || new Set(runs.map(r => r.id)).size !== runs.length) return null;
  const matches = runs.filter(run => isExactPackagingRun({ id: jobId, status: 'packaging', github_run_id: String(run.id), packaging_started_at: startedAt }, run, config));
  return matches.length === 1 ? { id: matches[0].id } : null;
}

export function getWorkflowRunAttemptJobs(runId: number, config = getGitHubActionsConfig(), timeoutMs = 8_000): Promise<WorkflowAttemptJobs> {
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('Invalid workflow run ID');
  return workflowEvidence('/actions/runs/' + runId + '/attempts/1/jobs?per_page=100', config, timeoutMs);
}

export async function getCheckRunAnnotations(checkId: number, config = getGitHubActionsConfig(), timeoutMs = 8_000): Promise<Array<{ message: string }>> {
  if (!Number.isSafeInteger(checkId) || checkId <= 0) throw new Error('Invalid check run ID');
  const rows = await workflowEvidence<unknown>('/check-runs/' + checkId + '/annotations?per_page=100', config, timeoutMs);
  if (!Array.isArray(rows)) throw new Error('Invalid check annotations');
  return rows.filter((x): x is { message: string } => !!x && typeof x.message === 'string').map(x => ({ message: x.message }));
}
