// Synthetic evidence for unit tests only. Never publish these records.
import { generateKeyPairSync } from 'node:crypto';
import { CURATED_APPS } from './definitions';
import { canonicalJson, createCandidate, sha256, signCatalog } from './core.mjs';
import { buildCuratedCartItem, curatedWorkflowInput } from './package';
import { normalizeQaWorkflowPackageInput, QA_PSADT_TOOLCHAIN } from '@/lib/qa/package-profile';
import type { CuratedAppDefinition, CuratedRelease } from './types';

export function releaseFixture(app: CuratedAppDefinition = CURATED_APPS[0], version = '120.0.0.0'): CuratedRelease {
  const now = Date.now();
  const at = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const hash = 'a'.repeat(64);
  const source = app.allowedInstallerSources[0];
  const candidate = createCandidate(app, {
    version, installerUrl: `${source.origin}${source.pathPrefix}test.${app.installerType === 'msi' ? 'msi' : 'exe'}`,
    vendorSha256: hash,
  }, new Date(at(24)));
  const release: CuratedRelease = {
    id: `${app.id}:${candidate.id}`, candidate, installerSha256: hash, executionProfileSha256: hash,
    preparedBy: 'test-preparer', approvedBy: 'test-approver', approvedAt: at(1),
    evidence: {
      provenance: { repository: 'ugurkocde/IntuneGet-Workflows', workflowPath: '.github/workflows/curated-catalog-verification.yml', workflowCommit: '1'.repeat(40), websiteCommit: '2'.repeat(40), runId: '123', runAttempt: 1, artifactId: '456', artifactSha256: 'b'.repeat(64) },
      verifiedAt: at(2), installerSha256: hash, installerVersion: version,
      architecture: app.architecture, sourceReviewedBy: 'test-source-reviewer', sourceReportUrl: 'https://example.test/source',
      signature: app.allowUnsigned
        ? { status: 'unsigned', publisher: null, exceptionReason: 'Synthetic unsigned exception used only by unit tests.' }
        : { status: 'valid', publisher: app.signaturePublishers[0] },
      security: { scanner: 'defender', status: 'clean', malicious: 0, suspicious: 0,
        scannedAt: at(2), reportUrl: 'https://example.test/security', installerSha256: hash },
      qa: { testLevel: 'psadt-package', executionContext: 'LocalSystem', installerSha256: hash,
        executionProfileSha256: hash, testedAt: at(2), reportUrl: 'https://example.test/qa',
        packagerCommit: QA_PSADT_TOOLCHAIN.packagerCommit, upgradeFromVersion: '1.0',
        phases: { install: { passed: true }, detectionAfterInstall: { passed: true },
          upgrade: { passed: true }, detectionAfterUpgrade: { passed: true },
          uninstall: { passed: true }, detectionAfterUninstall: { passed: true } },
      },
    },
  };
  release.executionProfileSha256 = normalizeQaWorkflowPackageInput(curatedWorkflowInput(buildCuratedCartItem(app, release))).identity.executionProfileSha256;
  release.evidence.qa.executionProfileSha256 = release.executionProfileSha256;
  return release;
}

export function signedFixture(releases = [releaseFixture()], withdrawnReleaseIds: string[] = []) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const payload = { schemaVersion: 1 as const, generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    definitionsSha256: sha256(canonicalJson(CURATED_APPS)), releases, withdrawnReleaseIds };
  return { envelope: signCatalog(payload, CURATED_APPS, 'unit-test', privatePem),
    keys: { 'unit-test': publicPem }, privatePem };
}
