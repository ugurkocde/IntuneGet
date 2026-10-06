export type CuratedArchitecture = 'x64' | 'x86';

export interface CuratedLicenceAttestation {
  /** Stable identifier of the agreement, shared by every app that requires it. */
  id: string;
  title: string;
  /** Official publisher URL where the customer reviews the agreement. */
  url: string;
  /** Changing the version requires every tenant to accept again. */
  version: string;
}

/** Audit copy of the acceptance stored with every packaging job it authorized. */
export interface CuratedLicenceAcceptanceSnapshot {
  attestationId: string;
  attestationVersion: string;
  acceptedAt: string;
  acceptedByUserId: string;
  acceptedByEmail: string | null;
}

export interface CuratedAppDefinition {
  id: string;
  packageId: string;
  wingetId: string;
  name: string;
  publisher: string;
  channel: string;
  category: string;
  homepage: string;
  architecture: CuratedArchitecture;
  scope: 'machine';
  locale: string;
  installerType: 'msi' | 'exe' | 'inno' | 'nullsoft';
  silentArgs: string;
  signaturePublishers: string[];
  allowUnsigned: boolean;
  /** Reviewed reason that an unsigned installer is acceptable. Required exactly when allowUnsigned is true. */
  unsignedExceptionReason?: string;
  releaseSource: string;
  discovery: 'github' | 'github-channel' | 'chrome' | 'firefox' | 'firefox-stable' | 'zoom' | 'aws-cli' | 'vscode' | 'vlc' | 'winscp' | 'putty' | 'adobe' | 'teamviewer' | 'python' | 'winrar' | 'node-lts' | 'wireshark' | 'manual';
  assetPattern?: string;
  releaseTagPrefix?: string;
  releaseVersionPattern?: string;
  /** Publisher baseline used only before the first approved release exists. */
  initialUpgradeBaseline?: { version: string; installerUrl: string };
  allowedInstallerSources: Array<{ origin: string; pathPrefix: string }>;
  /** Publisher checksum file fetched as text during discovery to pin vendorSha256. */
  checksumSource?: { urlTemplate: string; entryTemplate: string; format: 'sha256sums' | 'winscp-readme' | 'bsd-sha256' };
  /** Opt-in: verifier redirects may reach any HTTPS mirror because the SHA256 is pinned. */
  installerRedirectPolicy?: 'any-https-mirror-with-pinned-sha256';
  autoUpdate: 'vendor-managed' | 'none';
  notes: string;
  installedIdentity: {
    displayNamePattern: string;
    executablePaths: string[];
    /** Reviewed publisher release components; MSI build suffix remains hash-bound. Defaults to four. */
    versionComponents?: 3 | 4;
    /** CPython's final Windows release encodes patch * 1000 + 150 in its ARP version. */
    versionFormat?: 'python-msi';
  };
  /** Apps and Features display name and exact uninstall key or MSI product code registered by the installer. */
  registeredUninstall?: { displayName: string; key: string };
  licenceAttestation?: CuratedLicenceAttestation;
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
    provenance: { repository: string; workflowPath: string; workflowCommit: string; websiteCommit: string; runId: string; runAttempt: number; artifactId: string; artifactSha256: string };
    verifiedAt: string;
    installerSha256: string;
    installerVersion: string;
    architecture: CuratedArchitecture;
    sourceReviewedBy: string;
    sourceReportUrl: string;
    /** Observed Authenticode result, recorded for transparency. Not a release gate. */
    signature: {
      status: 'valid' | 'unsigned' | 'untrusted';
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
      /** Absent only when `upgrade` records a reviewed skipped upgrade test. */
      upgradeFromVersion?: string;
      /**
       * Present only when no earlier official build was tested. Allowed for
       * `autoUpdate: 'vendor-managed'` apps with the maintainer's written reason.
       */
      upgrade?: { tested: false; reason: string };
      phases: Record<'install' | 'detectionAfterInstall' | 'uninstall' | 'detectionAfterUninstall', { passed: boolean }> &
        Partial<Record<'upgrade' | 'detectionAfterUpgrade', { passed: boolean }>>;
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
