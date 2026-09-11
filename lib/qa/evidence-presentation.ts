import type { QaOutcome, QaPhaseResult, QaPhaseResults } from '@/types/qa';

export type QaPhaseKey = keyof QaPhaseResults;

export const QA_RESULT_PHASES: Array<{ key: QaPhaseKey; label: string }> = [
  { key: 'install', label: 'Install' },
  { key: 'detectionAfterInstall', label: 'Detection after install' },
  { key: 'uninstall', label: 'Uninstall' },
  { key: 'detectionAfterUninstall', label: 'Detection after uninstall' },
];

export function getEvidencePhaseStatus(key: QaPhaseKey, result: QaPhaseResult | null) {
  if (!result) return { label: 'Not run', passed: null };
  if (result.timedOut) return { label: 'Timed out', passed: false };
  if (key === 'detectionAfterUninstall') {
    return result.exitCode !== 0
      ? { label: 'Removal verified', passed: true }
      : { label: 'Still detected', passed: false };
  }
  const passed = key === 'detectionAfterInstall'
    ? result.exitCode === 0
    : [0, 3010, 1641].includes(result.exitCode);
  return { label: passed ? 'Passed' : 'Failed', passed };
}

export function getEvidenceSummary(outcome: QaOutcome, phases: QaPhaseResults): string {
  const failed = QA_RESULT_PHASES.find(({ key }) => getEvidencePhaseStatus(key, phases[key]).passed === false);
  if (failed) {
    const message = phases[failed.key]?.timedOut ? `${failed.label} timed out.` : `${failed.label} failed.`;
    const later = QA_RESULT_PHASES.slice(QA_RESULT_PHASES.indexOf(failed) + 1);
    return later.length > 0 && later.every(({ key }) => !phases[key])
      ? `${message} Later checks were not run.`
      : `${message} Review the recorded checks below.`;
  }
  if (QA_RESULT_PHASES.some(({ key }) => !phases[key])) {
    return 'The full installation lifecycle was not recorded. Review the available checks below.';
  }
  return outcome === 'Passed'
    ? 'Installation, detection, uninstall, and removal verification all passed.'
    : 'The run reported a failure. Review the recorded checks and technical details.';
}

export function evidenceTargetName(target: string): string {
  const withoutTrailingSeparators = target.replace(/[\\/]+$/, '');
  return withoutTrailingSeparators.split(/[\\/]/).pop() || target;
}
