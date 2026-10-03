export interface CuratedAppDefinition {
  id: string;
  packageId: string;
  wingetId: string;
  name: string;
  publisher: string;
  channel: string;
  category: string;
  homepage: string;
  architecture: 'x64';
  scope: 'machine';
  locale: string;
  installerType: 'msi' | 'exe' | 'inno' | 'nullsoft';
  silentArgs: string;
  signaturePublishers: string[];
  allowUnsigned: boolean;
  releaseSource: string;
  discovery: 'github' | 'chrome' | 'firefox' | 'vscode' | 'vlc' | 'winscp' | 'putty' | 'manual';
  assetPattern?: string;
  allowedInstallerSources: Array<{ origin: string; pathPrefix: string }>;
  autoUpdate: 'vendor-managed' | 'none';
  notes: string;
}

export interface CuratedCandidate {
  id: string;
  appId: string;
  version: string;
  installerUrl: string;
  vendorSha256: string | null;
  releaseNotesUrl: string;
  discoveredAt: string;
}

export interface CuratedRelease {
  id: string;
  candidate: CuratedCandidate;
  installerSha256: string;
  executionProfileSha256: string;
  preparedBy: string;
  approvedBy: string;
  approvedAt: string;
  evidence: {
    verifiedAt: string;
    installerSha256: string;
    installerVersion: string;
    architecture: 'x64';
    sourceReviewedBy: string;
    sourceReportUrl: string;
    signature: {
      status: 'valid' | 'unsigned';
      publisher: string | null;
      exceptionReason?: string;
    };
    security: {
      scanner: 'virustotal' | 'defender';
      status: 'clean';
      malicious: number;
      suspicious: number;
      scannedAt: string;
      reportUrl: string;
      installerSha256: string;
    };
    qa: {
      testLevel: 'psadt-package';
      executionContext: 'LocalSystem';
      installerSha256: string;
      executionProfileSha256: string;
      testedAt: string;
      reportUrl: string;
      packagerCommit: string;
      upgradeFromVersion: string;
      phases: Record<
        'install' | 'detectionAfterInstall' | 'uninstall' | 'detectionAfterUninstall' | 'upgrade' | 'detectionAfterUpgrade',
        { passed: boolean }
      >;
    };
  };
}

export interface CuratedCatalogEnvelope {
  payload: {
    schemaVersion: 1;
    generatedAt: string | null;
    expiresAt: string | null;
    definitionsSha256: string | null;
    releases: CuratedRelease[];
    withdrawnReleaseIds: string[];
  };
  keyId: string | null;
  signature: string | null;
}

export interface CuratedCatalogEntry {
  app: CuratedAppDefinition;
  status: 'pending' | 'approved' | 'withdrawn';
  release: CuratedRelease | null;
}
