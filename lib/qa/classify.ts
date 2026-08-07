import type {
  QaChanges,
  QaClassification,
  QaFailureBucket,
  QaPhaseResult,
  QaPhaseResults,
} from '@/types/qa';

const SUCCESS_EXIT_CODES = new Set([0, 3010, 1641]);
const ENVIRONMENT_INSTALL_CODES = new Set([1601, 1618, 1622]);

const REMEDIATION: Record<QaFailureBucket, string> = {
  package_definition:
    "Review and correct the app's QA definition: silent switches, detection rule, or uninstall command.",
  vendor_installer:
    'The vendor installer appears to fail even when driven correctly. Test a newer vendor release before deployment.',
  environment:
    'The result may be specific to the QA machine. Re-run the test before changing the package definition.',
  unknown:
    'The available aggregate evidence is inconclusive. Review the failing phase and its exit code.',
};

function resultPassed(result: QaPhaseResult | null): boolean {
  return Boolean(result && !result.timedOut && SUCCESS_EXIT_CODES.has(result.exitCode));
}

function makeClassification(
  signal: string,
  bucket: QaFailureBucket,
  confidence: QaClassification['confidence'],
  evidence: string
): QaClassification {
  return {
    signal,
    bucket,
    confidence,
    evidence,
    remediation: REMEDIATION[bucket],
    source: 'heuristic',
  };
}

/**
 * Produces a likely-cause signal from compact numeric evidence only. It is not
 * a verified root cause and never treats residual change counts as proof of a
 * dirty uninstall.
 */
export function classifyQaFailure(
  phases: QaPhaseResults,
  changes: QaChanges | null
): QaClassification {
  const install = phases.install;
  const detectionAfterInstall = phases.detectionAfterInstall;
  const uninstall = phases.uninstall;
  const detectionAfterUninstall = phases.detectionAfterUninstall;

  if (install.timedOut) {
    return makeClassification(
      'install_timed_out',
      'package_definition',
      'medium',
      'The silent install command exceeded the configured timeout.'
    );
  }

  if (ENVIRONMENT_INSTALL_CODES.has(install.exitCode)) {
    return makeClassification(
      'install_environment_blocked',
      'environment',
      'medium',
      `The installer returned Windows Installer environment code ${install.exitCode}.`
    );
  }

  if (!SUCCESS_EXIT_CODES.has(install.exitCode)) {
    return makeClassification(
      'install_failed',
      'unknown',
      'low',
      `The installer returned exit code ${install.exitCode}.`
    );
  }

  if (detectionAfterInstall && detectionAfterInstall.exitCode !== 0) {
    const filesAdded = changes?.afterInstall.fileSystemItems.added ?? 0;
    return makeClassification(
      filesAdded > 5 ? 'detection_missed_after_install' : 'silent_install_noop',
      'package_definition',
      filesAdded > 5 ? 'high' : 'medium',
      filesAdded > 5
        ? `Installation changed the filesystem (${filesAdded} additions), but the detection rule did not match.`
        : 'The install command returned success, but detection failed and few filesystem additions were observed.'
    );
  }

  if (uninstall?.exitCode === 1605) {
    return makeClassification(
      'uninstall_unknown_product',
      'package_definition',
      'high',
      'Windows Installer reported that the configured product is not installed (exit code 1605).'
    );
  }

  if (uninstall?.timedOut) {
    return makeClassification(
      'uninstall_timed_out',
      'package_definition',
      'medium',
      'The silent uninstall command exceeded the configured timeout.'
    );
  }

  if (uninstall && !SUCCESS_EXIT_CODES.has(uninstall.exitCode)) {
    return makeClassification(
      'uninstall_failed',
      'package_definition',
      'medium',
      `The uninstall command returned exit code ${uninstall.exitCode}.`
    );
  }

  if (resultPassed(uninstall) && detectionAfterUninstall?.exitCode === 0) {
    return makeClassification(
      'residual_detection',
      'package_definition',
      'medium',
      'The uninstall command succeeded, but the configured detection rule still matched.'
    );
  }

  if (
    (resultPassed(install) && !detectionAfterInstall) ||
    (detectionAfterInstall?.exitCode === 0 && !uninstall) ||
    (resultPassed(uninstall) && !detectionAfterUninstall)
  ) {
    return makeClassification(
      'phase_not_run',
      'environment',
      'low',
      'A later QA phase did not run after an earlier phase completed.'
    );
  }

  return makeClassification(
    'unclassified',
    'unknown',
    'low',
    'No known failure pattern matched the compact phase results.'
  );
}
