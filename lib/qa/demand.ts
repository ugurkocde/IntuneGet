import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeQaInstallerType, qaInstallerFileName } from '@/lib/qa/candidate';
import {
  buildQaPackageIdentityFromWorkflowInput,
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
  } else if (existing.status === 'queued' && existing.priority < input.priority) {
    await supabase
      .from('qa_candidates')
      .update({ priority: input.priority, demand_source: input.demandSource, updated_at: now })
      .eq('id', existing.id)
      .eq('status', 'queued');
  }

  return { identity, candidateId: existing.id, state: 'waiting' };
}
