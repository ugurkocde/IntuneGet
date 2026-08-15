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
      `Installation testing failed for ${details.wingetId} ${details.testedVersion} (${details.architecture})`
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
      `Installation testing has not passed yet for ${details.wingetId} ${details.version} (${details.architecture})`
    );
    this.name = 'QaGateNotPassedError';
  }
}

export class QaSecurityGateError extends Error {
  readonly code = 'QA_SECURITY_FLAGGED_CURRENT_VERSION' as const;

  constructor(
    readonly details: {
      wingetId: string;
      version: string;
      architecture: string;
      malicious: number;
      totalEngines: number | null;
    }
  ) {
    super(
      `VirusTotal reported ${details.malicious} malicious verdict${details.malicious === 1 ? '' : 's'} for the ${details.wingetId} ${details.version} (${details.architecture}) installer`
    );
    this.name = 'QaSecurityGateError';
  }
}

export type AnyQaGateError = QaGateError | QaGateNotPassedError | QaSecurityGateError;

export function isQaGateError(error: unknown): error is AnyQaGateError {
  return (
    error instanceof QaGateError ||
    error instanceof QaGateNotPassedError ||
    error instanceof QaSecurityGateError
  );
}

export function describeQaGateError(error: AnyQaGateError): string {
  if (error instanceof QaSecurityGateError) {
    return `${error.message}. Packaging is blocked for this version until the finding is reviewed. Earlier versions with a clean verdict remain available.`;
  }
  if (error instanceof QaGateNotPassedError) {
    return `${error.message}. Automatic deployment will resume after the installation test passes.`;
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
  if (input.sourceType === 'custom') return;

  const architecture = (input.architecture || 'x64').toLowerCase();
  const installerSha256 = input.installerSha256?.trim().toUpperCase() || '';
  const packageProfileSha256 = input.packageProfileSha256?.trim().toUpperCase() || '';

  // Security gate: a malicious VirusTotal verdict for this exact installer
  // blocks packaging even when the installability gate is overridden.
  if (installerSha256) {
    const { data: securityRow, error: securityError } = await createServerClient()
      .from('qa_package_results')
      .select('virustotal_malicious, virustotal_total_engines')
      .eq('winget_id', input.wingetId)
      .eq('tested_version', input.version)
      .eq('architecture', architecture)
      .eq('installer_sha256', installerSha256)
      .gte('virustotal_malicious', 1)
      .order('tested_at_utc', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (securityError) {
      throw new Error(`Could not read the installer security verdict: ${securityError.message}`);
    }
    const malicious = (securityRow?.virustotal_malicious as number | null) ?? 0;
    if (malicious >= 1) {
      throw new QaSecurityGateError({
        wingetId: input.wingetId,
        version: input.version,
        architecture,
        malicious,
        totalEngines: (securityRow?.virustotal_total_engines as number | null) ?? null,
      });
    }
  }

  if (!input.requirePassed && input.qaOverride) return;

  const { data: passedRow, error: passedError } = installerSha256
    ? await createServerClient()
        .from('qa_package_results')
        .select('winget_id, tested_version, architecture, installer_sha256, outcome')
        .eq('winget_id', input.wingetId)
        .eq('tested_version', input.version)
        .eq('architecture', architecture)
        .eq('installer_sha256', installerSha256)
        .eq('outcome', 'Passed')
        .order('tested_at_utc', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (passedError) throw new Error(`Could not read app-version QA result: ${passedError.message}`);
  if (passedRow) return;

  if (input.requirePassed) {
    throw new QaGateNotPassedError({
      wingetId: input.wingetId,
      version: input.version,
      architecture,
      installerSha256,
      packageProfileSha256,
      reason: installerSha256 ? 'missing' : 'installer_sha256',
    });
  }

  const row = await getCatalogSource().getQaResult(input.wingetId);

  if (
    !row ||
    row.tested_version !== input.version ||
    (input.architecture && row.architecture.toLowerCase() !== input.architecture.toLowerCase()) ||
    row.test_level !== 'psadt-package'
  ) {
    return;
  }

  if ((row.virustotal_malicious ?? 0) >= 1) {
    throw new QaSecurityGateError({
      wingetId: row.winget_id,
      version: row.tested_version,
      architecture: row.architecture,
      malicious: row.virustotal_malicious ?? 0,
      totalEngines: row.virustotal_total_engines ?? null,
    });
  }

  if (row.outcome !== 'Failed') return;

  throw new QaGateError({
    wingetId: row.winget_id,
    testedVersion: row.tested_version,
    testedAtUtc: row.tested_at_utc,
    architecture: row.architecture,
    classification: classifyQaFailure(row.phase_results, row.changes),
  });
}
