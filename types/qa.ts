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
  type: 'fileVersion' | 'installationEvidence' | 'intuneRules';
  path?: string;
  minimumVersion?: string;
  description?: string;
}

export interface QaEnvironment {
  executionContext: 'LocalSystem' | 'User';
}

export interface QaPromptConfiguration {
  closePrompt: boolean;
  deferral: boolean;
  progressDialog: boolean;
  customPromptCount: number;
  restartPrompt: boolean;
  balloonTipCount: number;
}

export interface QaEffectiveConfiguration {
  deployMode: 'Auto' | 'Silent' | 'NonInteractive';
  /** Vendor-provided arguments only; custom deployment arguments are withheld. */
  vendorSilentArguments: string | null;
  restartBehavior: 'Suppress' | 'Force' | 'Prompt';
  promptConfiguration: QaPromptConfiguration;
  processCloseCount: number;
  uiEvidenceExpected: boolean;
}

/** Count/flag-only PSADT configuration safe for the public live QA view. */
export type QaLiveUiConfiguration = Omit<QaEffectiveConfiguration, 'vendorSilentArguments'>;

export type QaLiveActivityKind = 'file' | 'registry';
export type QaLiveActivityChange = 'added' | 'changed' | 'removed';

export interface QaLiveActivityItem {
  kind: QaLiveActivityKind;
  change: QaLiveActivityChange;
  target: string;
}

export interface QaLiveActivityCounts {
  registryAdded: number;
  registryChanged: number;
  registryRemoved: number;
  filesAdded: number;
  filesChanged: number;
  filesRemoved: number;
}

export interface QaLiveActivity {
  stage: 'during_install' | 'after_install' | 'after_uninstall';
  observedAt: string;
  counts: QaLiveActivityCounts;
  items: QaLiveActivityItem[];
  truncated: boolean;
}

export interface QaLiveLog {
  source: 'PSADT';
  observedAt: string;
  lastWriteAt: string;
  lines: string[];
}

export type QaLivePhase =
  | 'queued'
  | 'scanning_installer'
  | 'preparing_package'
  | 'restoring_vm'
  | 'installing'
  | 'detecting_install'
  | 'uninstalling'
  | 'verifying_removal'
  | 'publishing';

export interface QaLiveResponse {
  serverTime: string;
  active: boolean;
  runner: {
    state: 'idle' | 'testing' | 'stalled';
    heartbeatAt: string | null;
  };
  scheduler: {
    state: 'healthy' | 'degraded' | 'unknown';
    lastPollAt: string | null;
    lastOutcome: 'running' | 'succeeded' | 'partial' | 'failed' | null;
    issue: 'github_rate_limit' | 'upstream_error' | 'stalled' | null;
    consecutiveFailures: number;
  };
  current: {
    wingetId: string;
    displayName: string;
    publisher: string | null;
    version: string;
    catalogVersion: string;
    architecture: QaArchitecture;
    executionContext: 'LocalSystem' | 'User';
    deployMode: 'Auto' | 'Silent' | 'NonInteractive';
    dialogExpected: boolean;
    expectedUi: QaLiveUiConfiguration | null;
    phase: QaLivePhase;
    phaseStartedAt: string | null;
    startedAt: string;
    elapsedSeconds: number;
  } | null;
  viewer: {
    candidateId: string | null;
    available: boolean;
    capturedAt: string | null;
    sequence: number | null;
    width: number | null;
    height: number | null;
  };
  activity: QaLiveActivity | null;
  log: QaLiveLog | null;
  queue: {
    count: number;
    next: Array<{
      wingetId: string;
      displayName: string;
      version: string;
      architecture: QaArchitecture;
      enqueuedAt: string;
    }>;
  };
  recent: Array<{
    wingetId: string;
    packageProfileSha256: string;
    displayName: string;
    testedVersion: string;
    catalogVersion: string;
    architecture: QaArchitecture;
    outcome: QaOutcome;
    testedAtUtc: string;
    durationSeconds: number | null;
    virusTotalStatus: QaVirusTotalStatus | null;
  }>;
}

export type QaTestLevel = 'installer-preflight' | 'psadt-package';

export type QaVirusTotalStatus = 'clean' | 'suspicious' | 'flagged' | 'not_found' | 'error' | 'skipped';

/** Informational hash-only VirusTotal verdict; it never gates the QA outcome. */
export interface QaVirusTotalSummary {
  status: QaVirusTotalStatus;
  malicious: number | null;
  suspicious: number | null;
  totalEngines: number | null;
  scannedAtUtc: string | null;
}

/** Minimal database row used for card/list status badges. */
export interface QaStatusRow {
  winget_id: string;
  outcome: QaOutcome;
  tested_version: string;
  architecture: QaArchitecture;
  tested_at_utc: string;
  test_level: QaTestLevel;
  package_profile_sha256: string | null;
}

export interface QaCandidateStatusRow {
  winget_id: string;
  version: string;
  architecture: QaArchitecture;
  installer_sha256: string;
  status: 'queued' | 'dispatched' | 'running';
  enqueued_at: string;
  started_at: string | null;
  test_level: QaTestLevel;
  package_profile_sha256: string | null;
}

/** Full compact database row used only when details or the gate are requested. */
export interface QaResultRow extends QaStatusRow {
  display_name: string;
  publisher: string;
  installer_sha256: string | null;
  overall_duration_seconds: number | null;
  installer_type: string | null;
  install_command: string;
  uninstall_command: string;
  detection: QaDetectionRule;
  phase_results: QaPhaseResults;
  changes: QaChanges | null;
  relevant_event_count: number | null;
  environment: QaEnvironment | null;
  effective_configuration: QaEffectiveConfiguration | null;
  qa_schema_version: number;
  synced_at: string;
  psadt_version: string | null;
  psadt_template_sha256: string | null;
  psadt_config_sha256: string | null;
  detection_rules_sha256: string | null;
  packager_commit: string | null;
  package_content_sha256: string | null;
  /** Optional: absent from rows read out of pre-VirusTotal catalog snapshots. */
  virustotal_status?: QaVirusTotalStatus | null;
  virustotal_malicious?: number | null;
  virustotal_suspicious?: number | null;
  virustotal_total_engines?: number | null;
  virustotal_scanned_at_utc?: string | null;
}

export interface QaStatus {
  outcome: QaOutcome | 'Queued' | 'Running';
  testedVersion: string;
  architecture: QaArchitecture;
  testedAtUtc: string;
  installerSha256?: string;
  testLevel: QaTestLevel;
  packageProfileSha256?: string;
}

export type QaBadgeState =
  | 'passed'
  | 'failed'
  | 'stale_passed'
  | 'stale_failed'
  | 'queued'
  | 'running'
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
  effectiveConfiguration: QaEffectiveConfiguration | null;
  virusTotal: QaVirusTotalSummary | null;
  classification: QaClassification | null;
  package?: {
    testLevel: QaTestLevel;
    profileSha256: string | null;
    psadtVersion: string | null;
    psadtTemplateSha256: string | null;
    psadtConfigSha256: string | null;
    detectionRulesSha256: string | null;
    packagerCommit: string | null;
    contentSha256: string | null;
  };
}
