import { getCatalogSource } from '@/lib/catalog';
import { classifyQaFailure } from '@/lib/qa/classify';
import { createServerClient } from '@/lib/supabase';
import type { QaClassification } from '@/types/qa';

export class QaGateError extends Error {
  readonly code = 'QA_FAILED_CURRENT_VERSION' as const;

  constructor(
    readonly details: {
      wingetId: string;
      testedVersion: string;
      testedAtUtc: string;
      architecture: string;
      classification: QaClassification;
    }
  ) {
    super(
      `QA testing failed for ${details.wingetId} ${details.testedVersion} (${details.architecture})`
    );
    this.name = 'QaGateError';
  }
}

export class QaGateNotPassedError extends Error {
  readonly code = 'QA_NOT_PASSED_CURRENT_VERSION' as const;

  constructor(
    readonly details: {
      wingetId: string;
      version: string;
      architecture: string;
      installerSha256: string;
      packageProfileSha256: string;
      reason:
        | 'missing'
        | 'failed'
        | 'version'
        | 'architecture'
        | 'installer_sha256'
        | 'package_profile';
    }
  ) {
    super(
      `Awaiting an exact PSADT package QA pass for ${details.wingetId} ${details.version} (${details.architecture}, ${details.installerSha256.slice(0, 8) || 'no hash'})`
    );
    this.name = 'QaGateNotPassedError';
  }
}

export type AnyQaGateError = QaGateError | QaGateNotPassedError;

export function isQaGateError(error: unknown): error is AnyQaGateError {
  return error instanceof QaGateError || error instanceof QaGateNotPassedError;
}

export function describeQaGateError(error: AnyQaGateError): string {
  if (error instanceof QaGateNotPassedError) {
    return `${error.message}. Automatic deployment will resume after that exact PSADT package profile has passed isolated QA.`;
  }
  const { classification, testedAtUtc } = error.details;
  return [
    error.message,
    `The failing result was recorded at ${testedAtUtc}.`,
    classification.evidence,
    classification.remediation,
  ].join(' ');
}

export async function enforceQaGate(input: {
  wingetId: string;
  version: string;
  architecture?: string;
  installerSha256?: string;
  packageProfileSha256?: string;
  requirePassed?: boolean;
  qaOverride?: boolean;
  sourceType?: 'winget' | 'custom';
}): Promise<void> {
  if (input.sourceType === 'custom' || (!input.requirePassed && input.qaOverride)) return;

  if (input.requirePassed) {
    const architecture = (input.architecture || 'x64').toLowerCase();
    const installerSha256 = input.installerSha256?.trim().toUpperCase() || '';
    const packageProfileSha256 = input.packageProfileSha256?.trim().toUpperCase() || '';
    const { data: row, error } = packageProfileSha256
      ? await createServerClient()
          .from('qa_package_results')
          .select(
            'winget_id, tested_version, architecture, installer_sha256, package_profile_sha256, outcome'
          )
          .eq('package_profile_sha256', packageProfileSha256)
          .maybeSingle()
      : { data: null, error: null };
    if (error) throw new Error(`Could not read package QA result: ${error.message}`);
    const reason = !packageProfileSha256
      ? 'package_profile'
      : !row
      ? 'missing'
      : row.outcome !== 'Passed'
        ? 'failed'
        : row.tested_version !== input.version
          ? 'version'
          : row.architecture.toLowerCase() !== architecture
            ? 'architecture'
            : !installerSha256 || row.installer_sha256?.toUpperCase() !== installerSha256
              ? 'installer_sha256'
              : null;

    if (!reason) return;
    throw new QaGateNotPassedError({
      wingetId: input.wingetId,
      version: input.version,
      architecture,
      installerSha256,
      packageProfileSha256,
      reason,
    });
  }

  const row = await getCatalogSource().getQaResult(input.wingetId);

  if (
    !row ||
    row.outcome !== 'Failed' ||
    row.tested_version !== input.version ||
    (input.architecture && row.architecture.toLowerCase() !== input.architecture.toLowerCase()) ||
    row.test_level !== 'psadt-package' ||
    (input.packageProfileSha256 &&
      row.package_profile_sha256?.toUpperCase() !== input.packageProfileSha256.toUpperCase())
  ) {
    return;
  }

  throw new QaGateError({
    wingetId: row.winget_id,
    testedVersion: row.tested_version,
    testedAtUtc: row.tested_at_utc,
    architecture: row.architecture,
    classification: classifyQaFailure(row.phase_results, row.changes),
  });
}
