import { getServerClientOrNull } from '@/lib/supabase';
import type { Json } from '@/types/database';
import { compatiblePriorExecutionProfileReason, normalizeQaWorkflowPackageInput, splitQaPsadtConfig, type QaWorkflowPackageInput } from '@/lib/qa/package-profile';
import { assertCuratedPackageProfile, buildCuratedCartItem, curatedWorkflowInput } from './package';
import { CuratedCatalogError } from './core.mjs';
import type { CuratedAppDefinition, CuratedRelease } from './types';

/**
 * Customised PSADT execution settings (processes to close, deferrals, deploy
 * mode, restart behaviour, prompts) are allowed for a curated release only
 * after that exact configuration passed its own isolated VM verification.
 * Presentation settings never need verification. Installer, arguments,
 * uninstall identity and detection always come from the signed release.
 */
export type CuratedConfigStatus = 'requested' | 'verifying' | 'passed' | 'failed';

export class CuratedConfigVerificationError extends CuratedCatalogError {
  readonly status: CuratedConfigStatus | 'unsupported';
  readonly verificationCode: 'CURATED_CONFIG_VERIFICATION_REQUIRED' | 'CURATED_CONFIG_VERIFICATION_FAILED';
  constructor(message: string, status: CuratedConfigStatus | 'unsupported') {
    super(message);
    this.name = 'CuratedConfigVerificationError';
    this.status = status;
    this.verificationCode = status === 'failed' ? 'CURATED_CONFIG_VERIFICATION_FAILED' : 'CURATED_CONFIG_VERIFICATION_REQUIRED';
    // API responses report the specific code instead of the generic release code.
    (this as unknown as { code: string }).code = this.verificationCode;
  }
}

export interface CuratedExecutionComparison {
  custom: boolean;
  psadtConfigSha256: string;
  executionProfileSha256: string;
  canonicalJson: string;
  /** Execution-only PSADT configuration the VM must test; presentation is stripped. */
  executionConfig: Record<string, unknown>;
}

/** Fails unless the input differs from the signed release only in its PSADT configuration. */
export function compareCuratedExecution(app: CuratedAppDefinition, release: CuratedRelease, input: QaWorkflowPackageInput): CuratedExecutionComparison {
  const base = curatedWorkflowInput(buildCuratedCartItem(app, release));
  const requested = normalizeQaWorkflowPackageInput({ ...input, packageDependencies: [] });
  const expected = normalizeQaWorkflowPackageInput({ ...base, psadtConfig: input.psadtConfig || base.psadtConfig });
  if (requested.identity.executionProfileSha256 !== expected.identity.executionProfileSha256) {
    throw new CuratedCatalogError('The requested package configuration differs from the approved curated release.');
  }
  const defaults = normalizeQaWorkflowPackageInput(base);
  return {
    custom: requested.identity.psadtConfigSha256 !== defaults.identity.psadtConfigSha256,
    psadtConfigSha256: requested.identity.psadtConfigSha256.toLowerCase(),
    executionProfileSha256: requested.identity.executionProfileSha256.toLowerCase(),
    canonicalJson: requested.identity.canonicalJson,
    executionConfig: splitQaPsadtConfig(requested.psadtConfig).execution as unknown as Record<string, unknown>,
  };
}

interface VerificationRow {
  id: string; status: CuratedConfigStatus; packager_commit: string | null;
  execution_profile_sha256: string | null; failure_detail: string | null;
}

/**
 * Authorizes the execution profile of a curated deployment. The default
 * profile is trusted through the signed catalog; a custom profile needs a
 * passed verification for this release. With `request`, an unverified custom
 * configuration is queued for the automation to verify.
 */
export async function authorizeCuratedExecution(
  app: CuratedAppDefinition, release: CuratedRelease, input: QaWorkflowPackageInput,
  request?: { tenantId?: string | null; userId?: string | null },
): Promise<CuratedExecutionComparison> {
  assertCuratedPackageProfile(app, release);
  const comparison = compareCuratedExecution(app, release, input);
  if (!comparison.custom) return comparison;

  const supabase = getServerClientOrNull();
  if (!supabase) {
    throw new CuratedConfigVerificationError(`Custom deployment behaviour for ${app.name} needs verification by the hosted IntuneGet QA service. Use the default settings on this installation.`, 'unsupported');
  }
  const { data, error } = await supabase.from('curated_config_verifications')
    .select('id,status,packager_commit,execution_profile_sha256,failure_detail')
    .eq('release_id', release.id).eq('psadt_config_sha256', comparison.psadtConfigSha256).maybeSingle();
  if (error) throw new CuratedCatalogError('Custom curated configuration verification is temporarily unavailable.');
  const row = data as VerificationRow | null;

  // A pass remains valid across later packager releases on the same rule as
  // the release itself: the tested profile must still be compatible.
  if (row?.status === 'passed' && row.packager_commit && row.execution_profile_sha256 &&
      compatiblePriorExecutionProfileReason(comparison.canonicalJson, row.packager_commit, row.execution_profile_sha256) === null) {
    return comparison;
  }
  if (row?.status === 'failed') {
    throw new CuratedConfigVerificationError(`These custom deployment settings for ${app.name} ${release.candidate.version} failed verification in the IntuneGet QA VM${row.failure_detail ? ` (${row.failure_detail})` : ''}. Adjust the settings or use the defaults.`, 'failed');
  }
  if (request) {
    const record = {
      release_id: release.id, app_id: app.id, winget_id: app.packageId, version: release.candidate.version,
      psadt_config_sha256: comparison.psadtConfigSha256, psadt_config: comparison.executionConfig as Json,
      tenant_id: request.tenantId || null, requested_by_user_id: request.userId || null,
    };
    // A stale pass (incompatible packager release) is verified again.
    // Status polling must not reset the dispatch timestamp or overwrite a
    // concurrent completion. Only a stale pass or a new request needs a write.
    if (!row || row.status === 'passed') {
      const write = row
        ? supabase.from('curated_config_verifications').update({ status: 'requested', updated_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'passed')
        : supabase.from('curated_config_verifications').insert({ ...record, status: 'requested' });
      const { error: writeError } = await write;
      if (writeError && !/duplicate key/i.test(writeError.message)) throw new CuratedCatalogError('Custom curated configuration verification could not be queued.');
    }
  }
  throw new CuratedConfigVerificationError(`Custom deployment settings for ${app.name} ${release.candidate.version} must pass an install, upgrade and uninstall test in the IntuneGet QA VM before first use. ${row && row.status !== 'passed' ? 'Verification is in progress' : 'Verification has been queued'}; it usually completes within about an hour. Deploy again afterwards.`, row?.status === 'verifying' ? 'verifying' : 'requested');
}
