import { getCatalogSource } from '@/lib/catalog';
import { classifyQaFailure } from '@/lib/qa/classify';
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

export function describeQaGateError(error: QaGateError): string {
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
  qaOverride?: boolean;
  sourceType?: 'winget' | 'custom';
}): Promise<void> {
  if (input.qaOverride || input.sourceType === 'custom') return;

  const row = await getCatalogSource().getQaResult(input.wingetId);
  if (
    !row ||
    row.outcome !== 'Failed' ||
    row.tested_version !== input.version ||
    (input.architecture && row.architecture.toLowerCase() !== input.architecture.toLowerCase())
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
