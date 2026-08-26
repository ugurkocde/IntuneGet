import type { SupabaseClient } from '@supabase/supabase-js';
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
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import { resolveApplicationInstallScope } from '@/lib/packaging-adapters';
import {
  getPackageEligibilityBlocks,
  PACKAGE_UNAVAILABLE_MESSAGE,
} from '@/lib/package-eligibility';
import { shouldReactivateSupersededCandidate } from '@/lib/qa/candidate-reactivation';

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

export async function ensureQaDemand(
  supabase: SupabaseClient,
  input: QaDemandInput
): Promise<QaDemandResult> {
  const installScope = resolveApplicationInstallScope(input.wingetId, input.installScope);
  const baseResolvedInput: QaDemandInput = {
    ...input,
    installScope,
    psadtConfig: JSON.stringify({
      ...DEFAULT_PSADT_CONFIG,
      deployMode: 'Auto',
      progressDialog: {
        enabled: true,
        statusMessage: 'IntuneGet is validating this application package.',
        windowLocation: 'BottomRight',
      },
    }),
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
  if (passedResult) {
    return { identity, candidateId: null, state: 'passed' };
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
  const now = new Date().toISOString();
  const testConfig = {
    mode: 'psadt-package',
    profileKind: 'deployment-config',
    ...(packageDependencies.length
      ? { packageDependencies: packageDependencies as unknown as Json }
      : {}),
    packageProfileCanonicalJson: identity.canonicalJson,
    packageProfileSha256: profileSha256,
    executionProfileSha256: profileSha256,
    presentationProfileSha256: identity.presentationProfileSha256,
    psadtConfigSha256: identity.psadtConfigSha256,
    detectionRulesSha256: identity.detectionRulesSha256,
    // Keep the real presentation values for the VM. The canonical execution
    // identity intentionally strips those values only for hashing/deduplication.
    psadtConfig: normalizedPackage.psadtConfig as unknown as Json,
    detectionRules: normalizedPackage.detectionRules as unknown as Json,
  };

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

  const { data: inserted, error: insertError } = await supabase
    .from('qa_candidates')
    .insert(row)
    .select('id, status, failure_summary')
    .maybeSingle();
  if (!insertError && inserted) {
    return { identity, candidateId: inserted.id, state: 'waiting' };
  }
  if (insertError?.code !== '23505') {
    throw new Error(`Could not queue exact package QA: ${insertError?.message || 'unknown error'}`);
  }

  // A database-level active-payload constraint closes the small race between
  // the lookup above and this insert. If another request won that race, join
  // its test even when it carries a different PSADT presentation profile.
  const { data: concurrentCandidate, error: concurrentError } = await supabase
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
  if (concurrentError) {
    throw new Error(`Could not resolve concurrent app-version QA: ${concurrentError.message}`);
  }
  if (concurrentCandidate) {
    return { identity, candidateId: concurrentCandidate.id, state: 'waiting' };
  }

  const { data: existing, error: existingError } = await supabase
    .from('qa_candidates')
    .select('id, status, priority, failure_summary')
    .eq('winget_id', input.wingetId)
    .eq('version', input.version)
    .eq('architecture', architecture)
    .eq('installer_sha256', installerSha256)
    .eq('package_profile_sha256', profileSha256)
    .maybeSingle();
  if (existingError || !existing) {
    throw new Error(`Could not resolve exact package QA candidate: ${existingError?.message || 'missing candidate'}`);
  }

  if (existing.status === 'failed') {
    return {
      identity,
      candidateId: existing.id,
      state: 'failed',
      failureSummary: existing.failure_summary || 'This app did not pass the isolated installation test.',
    };
  }

  if (
    existing.status === 'superseded' &&
    !shouldReactivateSupersededCandidate(existing.status, existing.failure_summary, true)
  ) {
    return {
      identity,
      candidateId: existing.id,
      state: 'failed',
      failureSummary:
        existing.failure_summary || 'This installer is no longer available for deployment.',
    };
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
