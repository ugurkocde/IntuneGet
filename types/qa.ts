export type QaOutcome = 'Passed' | 'Failed';
export type QaArchitecture = 'x64' | 'x86' | 'arm64';

export interface QaPhaseResult {
  exitCode: number;
  durationSeconds: number;
  timedOut: boolean;
}

export interface QaPhaseResults {
  install: QaPhaseResult;
  detectionAfterInstall: QaPhaseResult | null;
  uninstall: QaPhaseResult | null;
  detectionAfterUninstall: QaPhaseResult | null;
}

export interface QaChangeCounts {
  added: number;
  removed: number;
  changed: number;
}

export const QA_CHANGE_CATEGORIES = [
  'uninstallEntries',
  'registryValues',
  'fileSystemItems',
  'operatingSystem',
  'drivers',
  'windowsFeatures',
  'services',
  'scheduledTasks',
  'shortcuts',
] as const;

export type QaChangeCategory = (typeof QA_CHANGE_CATEGORIES)[number];
export type QaChangeSet = Record<QaChangeCategory, QaChangeCounts>;

export interface QaChanges {
  afterInstall: QaChangeSet;
  residualAfterUninstall: QaChangeSet;
}

export interface QaDetectionRule {
  type: 'fileVersion';
  path: string;
  minimumVersion: string;
}

export interface QaEnvironment {
  computerName: string;
  executedAs: string;
}

/** Minimal database row used for card/list status badges. */
export interface QaStatusRow {
  winget_id: string;
  outcome: QaOutcome;
  tested_version: string;
  architecture: QaArchitecture;
  tested_at_utc: string;
}

/** Full compact database row used only when details or the gate are requested. */
export interface QaResultRow extends QaStatusRow {
  display_name: string;
  publisher: string;
  overall_duration_seconds: number | null;
  installer_type: string | null;
  install_command: string;
  uninstall_command: string;
  detection: QaDetectionRule;
  phase_results: QaPhaseResults;
  changes: QaChanges | null;
  relevant_event_count: number | null;
  environment: QaEnvironment | null;
  test_id: string | null;
  github_run_id: string | null;
  github_run_attempt: number | null;
  qa_schema_version: number;
  synced_at: string;
}

export interface QaStatus {
  outcome: QaOutcome;
  testedVersion: string;
  architecture: QaArchitecture;
  testedAtUtc: string;
}

export type QaBadgeState =
  | 'passed'
  | 'failed'
  | 'stale_passed'
  | 'stale_failed'
  | 'untested';

export type QaFailureBucket =
  | 'package_definition'
  | 'vendor_installer'
  | 'environment'
  | 'unknown';

export type QaClassificationConfidence = 'high' | 'medium' | 'low';

export interface QaClassification {
  signal: string;
  bucket: QaFailureBucket;
  confidence: QaClassificationConfidence;
  evidence: string;
  remediation: string;
  source: 'heuristic' | 'upstream';
}

export interface QaDetailsResponse {
  wingetId: string;
  displayName: string;
  publisher: string;
  testedVersion: string;
  architecture: QaArchitecture;
  outcome: QaOutcome;
  testedAtUtc: string;
  overallDurationSeconds: number | null;
  installerType: string | null;
  commands: {
    install: string;
    uninstall: string;
  };
  detection: QaDetectionRule;
  phases: QaPhaseResults;
  changes: QaChanges | null;
  relevantEventCount: number | null;
  environment: QaEnvironment | null;
  testRun: {
    runId: string | null;
    runAttempt: number | null;
  };
  classification: QaClassification | null;
}
