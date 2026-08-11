import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeQaInstallerType, qaInstallerFileName } from '@/lib/qa/candidate';
import {
  buildQaPackageIdentityFromWorkflowInput,
  validateCompatiblePassedDeploymentQaProfile,
  type QaPackageIdentity,
  type QaWorkflowPackageInput,
} from '@/lib/qa/package-profile';
import type { Json } from '@/types/database';

export type QaDemandSource = 'customer' | 'auto_update' | 'managed' | 'operator';
export type QaDemandState = 'passed' | 'failed' | 'waiting';

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

const PACKAGE_RESULT_COLUMNS = [
  'package_profile_sha256',
  'winget_id',
  'tested_version',
  'architecture',
  'installer_sha256',
  'outcome',
  'tested_at_utc',
  'psadt_version',
  'psadt_template_sha256',
  'psadt_config_sha256',
  'detection_rules_sha256',
  'packager_commit',
  'package_content_sha256',
  'github_run_id',
  'github_run_url',
].join(', ');

interface CompatiblePackageResult {
  package_profile_sha256: string;
  winget_id: string;
  tested_version: string;
  architecture: string;
  installer_sha256: string;
  outcome: 'Passed';
  tested_at_utc: string;
  psadt_version: string;
  psadt_template_sha256: string;
  psadt_config_sha256: string;
  detection_rules_sha256: string;
  packager_commit: string;
  package_content_sha256: string;
  github_run_id: string | null;
  github_run_url: string | null;
}

async function aliasCompatiblePassedDeploymentResult(
  supabase: SupabaseClient,
  input: QaDemandInput,
  identity: QaPackageIdentity
): Promise<boolean> {
  const architecture = (input.architecture || 'x64').toLowerCase();
  const installerSha256 = input.installerSha256.toUpperCase();
  const { data: candidates, error: candidateError } = await supabase
    .from('qa_candidates')
    .select(
      'winget_id, version, architecture, installer_sha256, package_profile_sha256, test_config, finished_at'
    )
    .eq('winget_id', input.wingetId)
    .eq('version', input.version)
    .eq('architecture', architecture)
    .eq('installer_sha256', installerSha256)
    .eq('test_level', 'psadt-package')
    .eq('status', 'passed')
    .contains('test_config', { profileKind: 'deployment-config' })
    .order('finished_at', { ascending: false })
    .limit(100);
  if (candidateError) {
    throw new Error(`Could not read compatible package QA candidates: ${candidateError.message}`);
  }

  const compatibleHashes: string[] = [];
  for (const candidate of candidates || []) {
    if (!candidate.package_profile_sha256) continue;
    const validation = validateCompatiblePassedDeploymentQaProfile({
      prior: {
        testConfig: candidate.test_config,
        candidatePackageProfileSha256: candidate.package_profile_sha256,
        candidateWingetId: candidate.winget_id,
        candidateVersion: candidate.version,
        candidateArchitecture: candidate.architecture,
        candidateInstallerSha256: candidate.installer_sha256,
      },
      currentCanonicalJson: identity.canonicalJson,
      currentPackageProfileSha256: identity.executionProfileSha256,
    });
    if (validation.valid) compatibleHashes.push(candidate.package_profile_sha256);
  }
  if (compatibleHashes.length === 0) return false;

  const { data: compatibleResults, error: resultError } = await supabase
    .from('qa_package_results')
    .select(PACKAGE_RESULT_COLUMNS)
    .in('package_profile_sha256', compatibleHashes)
    .eq('outcome', 'Passed')
    .order('tested_at_utc', { ascending: false })
    .limit(1);
  if (resultError) {
    throw new Error(`Could not read compatible package QA results: ${resultError.message}`);
  }
  const source = (compatibleResults as unknown as CompatiblePackageResult[] | null)?.[0];
  if (!source) return false;

  const { error: aliasError } = await supabase
    .from('qa_package_results')
    .insert({
      package_profile_sha256: identity.executionProfileSha256,
      winget_id: source.winget_id,
      tested_version: source.tested_version,
      architecture: source.architecture,
      installer_sha256: source.installer_sha256,
      outcome: source.outcome,
      tested_at_utc: source.tested_at_utc,
      psadt_version: source.psadt_version,
      psadt_template_sha256: source.psadt_template_sha256,
      psadt_config_sha256: source.psadt_config_sha256,
      detection_rules_sha256: source.detection_rules_sha256,
      packager_commit: source.packager_commit,
      package_content_sha256: source.package_content_sha256,
      github_run_id: source.github_run_id,
      github_run_url: source.github_run_url,
      synced_at: new Date().toISOString(),
    });
  if (aliasError && aliasError.code !== '23505') {
    throw new Error(`Could not preserve compatible package QA evidence: ${aliasError.message}`);
  }
  return true;
}

export async function ensureQaDemand(
  supabase: SupabaseClient,
  input: QaDemandInput
): Promise<QaDemandResult> {
  const identity = buildQaPackageIdentityFromWorkflowInput(input);
  const profileSha256 = identity.executionProfileSha256;

  const { data: passedResult, error: resultError } = await supabase
    .from('qa_package_results')
    .select('outcome')
    .eq('package_profile_sha256', profileSha256)
    .maybeSingle();
  if (resultError) throw new Error(`Could not read exact package QA result: ${resultError.message}`);
  if (passedResult?.outcome === 'Passed') {
    return { identity, candidateId: null, state: 'passed' };
  }
  if (passedResult?.outcome === 'Failed') {
    return {
      identity,
      candidateId: null,
      state: 'failed',
      failureSummary: 'This app did not pass the isolated installation test.',
    };
  }

  if (await aliasCompatiblePassedDeploymentResult(supabase, input, identity)) {
    return { identity, candidateId: null, state: 'passed' };
  }

  const architecture = (input.architecture || 'x64').toLowerCase();
  const installerSha256 = input.installerSha256.toUpperCase();
  const now = new Date().toISOString();
  const profile = identity.profile as {
    psadtConfig: unknown;
    detectionRules: unknown;
  };
  const testConfig = {
    mode: 'psadt-package',
    profileKind: 'deployment-config',
    ...(input.packageDependencies?.length
      ? { packageDependencies: input.packageDependencies as unknown as Json }
      : {}),
    packageProfileCanonicalJson: identity.canonicalJson,
    packageProfileSha256: profileSha256,
    executionProfileSha256: profileSha256,
    presentationProfileSha256: identity.presentationProfileSha256,
    psadtConfigSha256: identity.psadtConfigSha256,
    detectionRulesSha256: identity.detectionRulesSha256,
    psadtConfig: profile.psadtConfig as Json,
    detectionRules: profile.detectionRules as Json,
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
