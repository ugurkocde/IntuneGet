import { exactPayloadMaliciousQuery, exactPayloadReputationQuery, isCoveredCleanReputation } from '@/lib/qa/gate';
import { loadInstallerSecurityHolds } from '@/lib/qa/installer-security-holds';
import { arePackageDependenciesCovered } from '@/lib/qa/dependency-reputation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { insertQaCandidate } from '@/lib/qa/candidate-insert';
import { isCuratedPackageId } from '@/lib/curated-catalog/core.mjs';
import { authorizeCuratedWorkflow } from '@/lib/curated-catalog/server';
import {
  isQaRunnerArchitectureSupported,
  normalizeQaInstallerType,
  qaInstallerFileName,
} from '@/lib/qa/candidate';
import {
  normalizeQaWorkflowPackageInput,
  type QaPackageIdentity,
  type QaWorkflowPackageInput,
} from '@/lib/qa/package-profile';
import {
  isWingetDependencyCompatibilityError,
  resolveWingetPackageDependencies,
} from '@/lib/winget-dependencies';
import type { Json } from '@/types/database';
import { buildQaDeploymentTestConfig, QA_DEPLOYMENT_TEST_PSADT_CONFIG } from './deployment-test-config';
import { resolveApplicationInstallScope } from '@/lib/packaging-adapters';
import {
  getPackageCompatibilityBlock,
  getPackageEligibilityBlocks,
  PACKAGE_UNAVAILABLE_MESSAGE,
  PACKAGE_VERSION_UNAVAILABLE_MESSAGE,
} from '@/lib/package-eligibility';
import { AWAITING_DIAGNOSTIC_RETEST_GRANT, shouldReactivateSupersededCandidate } from '@/lib/qa/candidate-reactivation';
import {
  buildQaCandidatePreflightRequest,
  type QaCandidatePreflightInput,
} from '@/lib/qa/candidate-preflight';
import { enforceInstallerPreflight, InstallerPreflightError } from '@/lib/installer-preflight';

export type QaDemandSource = 'customer' | 'auto_update' | 'managed' | 'operator';
export type QaDemandState = 'passed' | 'failed' | 'waiting';

const QA_ARCHITECTURE_UNAVAILABLE_MESSAGE =
  'This app is not currently available for deployment.';

export interface QaDemandInput extends QaWorkflowPackageInput {
  installerUrl: string;
  priority: number;
  demandSource: QaDemandSource;
}

export interface QaDemandResult {
  identity: QaPackageIdentity;
  candidateId: string | null;
  state: QaDemandState;
  failureSummary?: string;
}

const MANIFEST_CHANGED_QUARANTINE_PREFIX =
  'Installer source quarantined before QA: MANIFEST_CHANGED.';

/**
 * A MANIFEST_CHANGED dispatch quarantine is evidence about the trusted WinGet
 * manifest at that time, not about the installer bytes. Reuse the exact
 * candidate only when the same preflight that QA dispatch enforces now accepts
 * it against the live manifest. HASH_MISMATCH and every other quarantine stay
 * terminal, and dispatch still repeats the full preflight before any VM run.
 * A retryable preflight failure keeps the candidate quarantined without
 * turning a temporary outage into a terminal result.
 */
async function recheckManifestQuarantine(
  existing: QaCandidatePreflightInput & { failure_summary: string | null },
  testConfig: Json,
): Promise<'recovered' | 'quarantined' | 'retry'> {
  if (!existing.failure_summary?.startsWith(MANIFEST_CHANGED_QUARANTINE_PREFIX)) return 'quarantined';
  try {
    await enforceInstallerPreflight(buildQaCandidatePreflightRequest({
      ...existing,
      test_config: testConfig,
    }));
    return 'recovered';
  } catch (error) {
    if (error instanceof InstallerPreflightError) return error.retryable ? 'retry' : 'quarantined';
    throw error;
  }
}

export async function ensureQaDemand(
  supabase: SupabaseClient,
  input: QaDemandInput
): Promise<QaDemandResult> {
  if (isCuratedPackageId(input.wingetId)) {
    await authorizeCuratedWorkflow(input);
    return { identity: normalizeQaWorkflowPackageInput({ ...input, packageDependencies: [] }).identity, candidateId: null, state: 'passed' };
  }
  const installScope = resolveApplicationInstallScope(input.wingetId, input.installScope);
  const baseResolvedInput: QaDemandInput = {
    ...input,
    installScope,
    psadtConfig: JSON.stringify(QA_DEPLOYMENT_TEST_PSADT_CONFIG),
  };
  if (!isQaRunnerArchitectureSupported(input.architecture)) {
    return {
      identity: normalizeQaWorkflowPackageInput(baseResolvedInput).identity,
      candidateId: null,
      state: 'failed',
      failureSummary: QA_ARCHITECTURE_UNAVAILABLE_MESSAGE,
    };
  }
  const eligibilityBlocks = await getPackageEligibilityBlocks(supabase, [input.wingetId]);
  if (eligibilityBlocks.length > 0) {
    return {
      identity: normalizeQaWorkflowPackageInput(baseResolvedInput).identity,
      candidateId: null,
      state: 'failed',
      failureSummary: PACKAGE_UNAVAILABLE_MESSAGE,
    };
  }
  const compatibilityBlock = await getPackageCompatibilityBlock(supabase, {
    wingetId: input.wingetId,
    version: input.version,
    architecture: input.architecture || 'x64',
    installerSha256: input.installerSha256,
  });
  if (compatibilityBlock) {
    return {
      identity: normalizeQaWorkflowPackageInput(baseResolvedInput).identity,
      candidateId: null,
      state: 'failed',
      failureSummary: PACKAGE_VERSION_UNAVAILABLE_MESSAGE,
    };
  }
  // Resolve at the QA-demand boundary as well as at final packaging dispatch.
  // This keeps both gates bound to the same server-trusted dependency graph;
  // caller-supplied dependency metadata is never authoritative.
  let packageDependencies: Awaited<ReturnType<typeof resolveWingetPackageDependencies>>;
  try {
    packageDependencies = await resolveWingetPackageDependencies({
      wingetId: input.wingetId,
      version: input.version,
      architecture: input.architecture,
      installerSha256: input.installerSha256,
      installScope,
    });
  } catch (error) {
    if (!isWingetDependencyCompatibilityError(error)) throw error;
    const identity = normalizeQaWorkflowPackageInput(baseResolvedInput).identity;
    const { error: blockError } = await supabase
      .from('qa_package_blocks')
      .upsert({
        winget_id: input.wingetId,
        version: input.version,
        architecture: (input.architecture || 'x64').toLowerCase(),
        installer_sha256: input.installerSha256.toUpperCase(),
        block_code: error.blockCode,
        detail: error.message,
        observed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'winget_id,version,architecture,installer_sha256',
      });
    if (blockError) {
      throw new Error(`Could not persist the package compatibility block: ${blockError.message}`);
    }
    return {
      identity,
      candidateId: null,
      state: 'failed',
      failureSummary: QA_ARCHITECTURE_UNAVAILABLE_MESSAGE,
    };
  }
  // The VM validates the same PSADT packaging route used for customer uploads,
  // with one deterministic, non-blocking visual profile per immutable payload.
  // Customer presentation choices are applied later by customer packaging and
  // must neither suppress QA evidence nor multiply app-version tests.
  const resolvedInput: QaDemandInput = {
    ...baseResolvedInput,
    packageDependencies,
  };
  const normalizedPackage = normalizeQaWorkflowPackageInput(resolvedInput);
  const identity = normalizedPackage.identity;
  const profileSha256 = identity.executionProfileSha256;
  const architecture = (input.architecture || 'x64').toLowerCase();
  const installerSha256 = input.installerSha256.toUpperCase();

  // QA qualifies the immutable application payload, not every possible PSADT
  // presentation or policy combination. One successful test for this exact
  // app/version/architecture/installer is sufficient for every customer upload.
  const { data: passedResult, error: resultError } = await supabase
    .from('qa_package_results')
    .select('package_profile_sha256')
    .eq('winget_id', input.wingetId)
    .eq('tested_version', input.version)
    .eq('architecture', architecture)
    .eq('installer_sha256', installerSha256)
    .eq('outcome', 'Passed')
    .order('tested_at_utc', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (resultError) throw new Error(`Could not read app-version QA result: ${resultError.message}`);
  let refreshingLegacyPass = false;
  if (passedResult) {
    // Keep this real demand waiting rather than treating the primary pass as
    // permission for uncovered prerequisite bytes. Do not reset a terminal
    // lifecycle or create a scan/grant as a side effect of checking coverage.
    if (!await arePackageDependenciesCovered(supabase, packageDependencies)) {
      // Attach real waiting demand only to this exact current profile. A
      // previously recorded receipt may then enter the existing bounded
      // dependency refresh lane; this never reactivates its lifecycle.
      const { data: dependencyCandidate, error: dependencyCandidateError } = await supabase
        .from('qa_candidates').select('id,status,phase,github_run_id')
        .eq('winget_id', input.wingetId).eq('version', input.version)
        .eq('architecture', architecture).eq('installer_sha256', installerSha256)
        .eq('package_profile_sha256', profileSha256).limit(1).maybeSingle();
      if (dependencyCandidateError) throw new Error('Dependency verification is unavailable');
      // qa-resume treats failed and non-publishing error candidates as a
      // terminal customer failure, not a reputation wait. Never attach them.
      const attach = dependencyCandidate && (
        ['queued', 'dispatched', 'running', 'passed'].includes(dependencyCandidate.status) ||
        (dependencyCandidate.status === 'error' && dependencyCandidate.phase === 'publishing' &&
          Boolean(dependencyCandidate.github_run_id))
      );
      return {
        identity, candidateId: attach ? dependencyCandidate.id : null, state: 'waiting',
        failureSummary: 'Installer reputation is awaiting verification.',
      };
    }
    const key = { wingetId: input.wingetId, version: input.version, architecture, installerSha256 };
    const { data: newest, error: reputationError } = await exactPayloadReputationQuery(supabase, key);
    if (reputationError) throw new Error(`Could not read exact payload reputation: ${reputationError.message}`);
    if (isCoveredCleanReputation(newest)) return { identity, candidateId: null, state: 'passed' };
    const { data: malicious, error: maliciousError } = await exactPayloadMaliciousQuery(supabase, key);
    if (maliciousError) throw new Error(`Could not read exact payload security: ${maliciousError.message}`);
    // Uncovered historical evidence can request one normal run; adverse or
    // unknown verdicts retain the existing gate decision and never queue work.
    if (!newest || (malicious?.virustotal_malicious ?? 0) >= 1 ||
        ![null, 'not_found', 'error', 'skipped', 'clean'].includes(newest.virustotal_status ?? null) ||
        (newest.virustotal_malicious != null && newest.virustotal_malicious !== 0) ||
        (newest.virustotal_suspicious != null && newest.virustotal_suspicious !== 0)) {
      return { identity, candidateId: null, state: 'passed' };
    }
    const holds = await loadInstallerSecurityHolds(supabase, [installerSha256]);
    if (holds.has(installerSha256.toLowerCase())) return { identity, candidateId: null, state: 'passed' };
    refreshingLegacyPass = true;
  }

  // If the same payload is already queued or running, attach this upload to
  // that test instead of multiplying VM runs for different PSADT settings.
  const { data: activeCandidate, error: activeError } = await supabase
    .from('qa_candidates')
    .select('id, status, priority')
    .eq('winget_id', input.wingetId)
    .eq('version', input.version)
    .eq('architecture', architecture)
    .eq('installer_sha256', installerSha256)
    .eq('test_level', 'psadt-package')
    .in('status', ['queued', 'dispatched', 'running'])
    .order('priority', { ascending: false })
    .order('enqueued_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (activeError) throw new Error(`Could not read active app-version QA: ${activeError.message}`);
  if (activeCandidate) {
    if (activeCandidate.status === 'queued' && activeCandidate.priority < input.priority) {
      const { error: priorityError } = await supabase
        .from('qa_candidates')
        .update({
          priority: input.priority,
          demand_source: input.demandSource,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeCandidate.id)
        .eq('status', 'queued');
      if (priorityError) throw new Error(`Could not prioritize app-version QA: ${priorityError.message}`);
    }
    return { identity, candidateId: activeCandidate.id, state: 'waiting' };
  }

  if (!refreshingLegacyPass) {
    const { data: failedResult, error: failedError } = await supabase
      .from('qa_package_results')
      .select('package_profile_sha256')
      .eq('winget_id', input.wingetId)
      .eq('tested_version', input.version)
      .eq('architecture', architecture)
      .eq('installer_sha256', installerSha256)
      .eq('package_profile_sha256', profileSha256)
      .eq('outcome', 'Failed')
      .order('tested_at_utc', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (failedError) throw new Error(`Could not read failed app-version QA: ${failedError.message}`);
    if (failedResult) {
      return {
        identity,
        candidateId: null,
        state: 'failed',
        failureSummary: 'This app did not pass the isolated installation test.',
      };
    }
  }
  const now = new Date().toISOString();
  const testConfig = buildQaDeploymentTestConfig(normalizedPackage, packageDependencies);

  const row = {
    winget_id: input.wingetId,
    definition_path: null,
    version: input.version,
    architecture,
    installer_url: input.installerUrl,
    installer_sha256: installerSha256,
    installer_type: normalizeQaInstallerType(input.installerType),
    installer_file_name: qaInstallerFileName(input.installerUrl, input.installerType),
    test_level: 'psadt-package' as const,
    package_profile_sha256: profileSha256,
    test_config: testConfig as unknown as Json,
    status: 'queued',
    priority: input.priority,
    demand_source: input.demandSource,
    updated_at: now,
  };

  const { data: inserted, existing, outcome, error: insertError } = await insertQaCandidate(supabase, row);
  if (!insertError && inserted) {
    return { identity, candidateId: inserted.id, state: 'waiting' };
  }
  if (insertError) {
    throw new Error(`Could not queue exact package QA: ${insertError?.message || 'unknown error'}`);
  }

  if (!existing) throw new Error('Could not resolve exact package QA candidate');
  // The RPC resolves the winner using the same expressions as the unique index.
  if (outcome === 'active_conflict') {
    return { identity, candidateId: existing.id, state: 'waiting' };
  }

  // A historical pass never authorizes resetting a terminal candidate to
  // obtain coverage. Preserve its existing hold and avoid repeated VM runs.
  if (refreshingLegacyPass && !['queued', 'dispatched', 'running'].includes(existing.status) &&
      !(existing.status === 'error' && existing.phase === 'publishing' && existing.github_run_id)) {
    return { identity, candidateId: null, state: 'passed' };
  }

  if (existing.status === 'failed') {
    return {
      identity,
      candidateId: existing.id,
      state: 'failed',
      failureSummary: existing.failure_summary || 'This app did not pass the isolated installation test.',
    };
  }

  // Adoption prepares a profile but never authorizes a lifecycle. Customer
  // demand must not turn it into queued work without the separate grant.
  if (existing.status === 'superseded' && existing.failure_summary === AWAITING_DIAGNOSTIC_RETEST_GRANT) {
    return { identity, candidateId: existing.id, state: 'waiting' };
  }

  const quarantineRecheck =
    existing.status === 'superseded' &&
    !shouldReactivateSupersededCandidate(existing.status, existing.failure_summary, true)
      ? await recheckManifestQuarantine(existing, testConfig as unknown as Json)
      : null;
  if (quarantineRecheck === 'retry') {
    return { identity, candidateId: existing.id, state: 'waiting' };
  }
  if (quarantineRecheck === 'quarantined') {
    return {
      identity,
      candidateId: existing.id,
      state: 'failed',
      failureSummary:
        existing.failure_summary || 'This installer is no longer available for deployment.',
    };
  }

  // A completed lifecycle awaiting protected result publication needs the
  // existing run recovered, not another installation of the same package.
  if (existing.status === 'error' && existing.phase === 'publishing' && existing.github_run_id) {
    return { identity, candidateId: existing.id, state: 'waiting' };
  }

  if (['error', 'superseded'].includes(existing.status)) {
    const { error: reactivateError } = await supabase
      .from('qa_candidates')
      .update({
        status: 'queued',
        priority: Math.max(existing.priority, input.priority),
        demand_source: input.demandSource,
        test_config: testConfig as unknown as Json,
        attempts: 0,
        dispatched_at: null,
        started_at: null,
        finished_at: null,
        github_run_id: null,
        github_run_url: null,
        failure_summary: null,
        updated_at: now,
      })
      .eq('id', existing.id)
      .in('status', ['error', 'superseded']);
    if (reactivateError) throw new Error(`Could not reactivate exact QA: ${reactivateError.message}`);
  } else if (existing.status === 'queued') {
    await supabase
      .from('qa_candidates')
      .update({
        priority: Math.max(existing.priority, input.priority),
        demand_source: input.demandSource,
        test_config: testConfig as unknown as Json,
        updated_at: now,
      })
      .eq('id', existing.id)
      .eq('status', 'queued');
  }

  return { identity, candidateId: existing.id, state: 'waiting' };
}
