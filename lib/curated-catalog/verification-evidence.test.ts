import { describe, expect, it } from 'vitest';
import { authenticatedCatalogReviewer, releaseFromVerification, type VerificationReport } from './verification-evidence';
import { createCuratedVerificationProfile } from './verification-profile';
import { releaseFixture } from './test-fixtures';
import { CURATED_APPS } from './definitions';

// Synthetic records exercise the importer; they never authorize real releases.
function fixture(app = CURATED_APPS[0]) {
  const release = releaseFixture(app);
  const previous = releaseFixture(app, '119.0.0.0');
  const inspection = (value: typeof release) => ({ candidateId: value.candidate.id, installerSha256: value.installerSha256,
    sourceUrl: value.candidate.installerUrl, finalOrigin: new URL(value.candidate.installerUrl).origin,
    signature: value.evidence.signature, security: value.evidence.security });
  const run = { id: 123, run_attempt: 1, repository: { full_name: 'ugurkocde/IntuneGet-Workflows' }, path: '.github/workflows/curated-catalog-verification.yml',
    event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: '1'.repeat(40) };
  const artifact = { id: 456, name: 'curated-verification-evidence', expired: false, digest: `sha256:${'b'.repeat(64)}`, workflow_run: { id: run.id, head_sha: run.head_sha } };
  const report: VerificationReport = { schemaVersion: 1, status: 'passed', vmRestored: true, verifiedAt: release.evidence.verifiedAt,
    provenance: { repository: run.repository.full_name, workflowPath: run.path, workflowCommit: run.head_sha, websiteCommit: '2'.repeat(40), runId: '123', runAttempt: '1' },
    candidate: release.candidate, previous: previous.candidate, inspection: { current: inspection(release), previous: inspection(previous) },
    profile: createCuratedVerificationProfile(release.candidate, release.installerSha256),
    qa: { ...release.evidence.qa, candidateId: release.candidate.id, installerVersion: release.candidate.version, architecture: app.architecture, upgradeFromVersion: previous.candidate.version, previousInstallerSha256: previous.installerSha256 },
  };
  const context = { websiteCommit: '2'.repeat(40), artifactSha256: 'b'.repeat(64), approvedBy: 'unit-test-maintainer', approvedAt: release.approvedAt };
  return { report, run, artifact, context };
}
// QA output when no earlier official build was supplied for the run.
const upgradeException = 'Google publishes no historical enterprise MSI, so no earlier official build exists.';
function skippedFixture(app = CURATED_APPS[0]) {
  const f = fixture(app);
  const { upgrade, detectionAfterUpgrade, ...phases } = f.report.qa.phases;
  void upgrade; void detectionAfterUpgrade;
  const { upgradeFromVersion, previousInstallerSha256, ...qa } = f.report.qa;
  void upgradeFromVersion; void previousInstallerSha256;
  f.report.previous = null; delete f.report.inspection.previous;
  f.report.qa = { ...qa, phases, upgrade: { tested: false } };
  return f;
}
describe('authenticated curated evidence', () => {
  it('binds a release to the successful run, exact artifact and production profile', () => {
    const f = fixture(); const result = releaseFromVerification(f.report, f.run, f.artifact, f.context);
    expect(result.evidence.provenance.artifactId).toBe('456');
    expect(result.approvedBy).toBe('unit-test-maintainer');
    expect(result.preparedBy).toContain('github-actions:');
    expect(result.evidence.sourceReportUrl).toContain('/catalog/curated/evidence/chrome/');
  });
  it.each(['conclusion', 'head_branch', 'repository', 'path'])('rejects a forged or unprotected %s', field => {
    const f = fixture(); Object.assign(f.run, { [field]: field === 'repository' ? { full_name: 'attacker/repo' } : 'untrusted' });
    expect(() => releaseFromVerification(f.report, f.run, f.artifact, f.context)).toThrow();
  });
  it('rejects another artifact, rerun, website revision or missing VM restoration', () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { f.artifact.digest = `sha256:${'c'.repeat(64)}`; },
      (f: ReturnType<typeof fixture>) => { f.report.provenance.runAttempt = '2'; },
      (f: ReturnType<typeof fixture>) => { f.report.provenance.websiteCommit = '3'.repeat(40); },
      (f: ReturnType<typeof fixture>) => { f.report.vmRestored = false; },
      (f: ReturnType<typeof fixture>) => { f.report.qa.executionProfileSha256 = 'c'.repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.report.qa.phases.upgrade!.passed = false; },
      (f: ReturnType<typeof fixture>) => { f.report.inspection.previous!.security.malicious = 1; },
    ]) {
      const f = fixture(); mutate(f); expect(() => releaseFromVerification(f.report, f.run, f.artifact, f.context)).toThrow();
    }
  });
  it('requires a separately reviewed explanation for unsigned 7-Zip', () => {
    const f = fixture(CURATED_APPS.find(app => app.id === '7zip')!);
    expect(() => releaseFromVerification(f.report, f.run, f.artifact, f.context)).toThrow(/exception/);
    expect(releaseFromVerification(f.report, f.run, f.artifact, { ...f.context, unsignedException: 'Unit test explanation for a reviewed unsigned vendor installer.' }).evidence.signature.status).toBe('unsigned');
  });
  it('binds QA architecture to the reviewed x86 WinSCP definition', () => {
    const f = fixture(CURATED_APPS.find(app => app.id === 'winscp')!);
    expect(releaseFromVerification(f.report, f.run, f.artifact, f.context).evidence.architecture).toBe('x86');
    f.report.qa.architecture = 'x64';
    expect(() => releaseFromVerification(f.report, f.run, f.artifact, f.context)).toThrow(/production profile/);
  });
  it('records a reviewed skipped upgrade for a vendor-managed app without an earlier build', () => {
    const f = skippedFixture();
    expect(() => releaseFromVerification(f.report, f.run, f.artifact, f.context)).toThrow(/why the upgrade was not tested/);
    expect(() => releaseFromVerification(f.report, f.run, f.artifact, { ...f.context, upgradeException: 'too short' })).toThrow(/why the upgrade was not tested/);
    const release = releaseFromVerification(f.report, f.run, f.artifact, { ...f.context, upgradeException });
    expect(release.evidence.qa.upgrade).toEqual({ tested: false, reason: upgradeException });
    expect(release.evidence.qa.upgradeFromVersion).toBeUndefined();
    expect(release.evidence.qa.phases.upgrade).toBeUndefined();
  });
  it('rejects a skipped upgrade for an app without a vendor updater', () => {
    const f = skippedFixture(CURATED_APPS.find(app => app.id === 'git')!);
    expect(() => releaseFromVerification(f.report, f.run, f.artifact, { ...f.context, upgradeException })).toThrow(/vendor-managed/);
  });
  it('rejects a skipped upgrade report that is not explicit or carries upgrade evidence', () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { delete f.report.qa.upgrade; },
      (f: ReturnType<typeof fixture>) => { f.report.qa.upgradeFromVersion = '119.0.0.0'; },
      (f: ReturnType<typeof fixture>) => { f.report.qa.previousInstallerSha256 = 'a'.repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.report.inspection.previous = fixture().report.inspection.previous; },
      (f: ReturnType<typeof fixture>) => { f.report.qa.phases.upgrade = { passed: true }; },
      (f: ReturnType<typeof fixture>) => { f.report.qa.phases.uninstall.passed = false; },
    ]) {
      const f = skippedFixture(); mutate(f);
      expect(() => releaseFromVerification(f.report, f.run, f.artifact, { ...f.context, upgradeException })).toThrow();
    }
  });
  it('requires the upgrade to run and pass whenever an earlier build was supplied, even for vendor-managed apps', () => {
    expect(CURATED_APPS[0].autoUpdate).toBe('vendor-managed');
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { f.report.qa.upgrade = { tested: false }; },
      (f: ReturnType<typeof fixture>) => { delete f.report.qa.phases.upgrade; },
      (f: ReturnType<typeof fixture>) => { delete f.report.qa.phases.detectionAfterUpgrade; },
      (f: ReturnType<typeof fixture>) => { f.report.qa.phases.detectionAfterUpgrade!.passed = false; },
      (f: ReturnType<typeof fixture>) => { delete f.report.qa.upgradeFromVersion; },
      (f: ReturnType<typeof fixture>) => { delete f.report.inspection.previous; },
    ]) {
      const f = fixture(); mutate(f);
      expect(() => releaseFromVerification(f.report, f.run, f.artifact, f.context)).toThrow();
    }
    const f = fixture();
    expect(() => releaseFromVerification(f.report, f.run, f.artifact, { ...f.context, upgradeException })).toThrow(/only when no earlier release/);
    expect(releaseFromVerification(f.report, f.run, f.artifact, { ...f.context, upgradeException: '  ' }).evidence.qa.upgrade).toBeUndefined();
  });
  it('takes the approver from GitHub required-reviewer history', () => {
    const environment = { can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 7 } }] }] };
    const reviews = [{ state: 'approved', environments: [{ name: 'curated-catalog-approval' }], user: { id: 7, type: 'User', login: 'unit-test-maintainer' } }];
    expect(authenticatedCatalogReviewer(reviews, environment)).toBe('unit-test-maintainer');
    expect(() => authenticatedCatalogReviewer(reviews, { ...environment, can_admins_bypass: true })).toThrow();
    expect(() => authenticatedCatalogReviewer([{ ...reviews[0], user: { ...reviews[0].user, id: 8 } }], environment)).toThrow();
    expect(() => authenticatedCatalogReviewer([{ ...reviews[0], user: { ...reviews[0].user, type: 'Bot' } }], environment)).toThrow();
    expect(() => authenticatedCatalogReviewer([], environment)).toThrow();
  });
});
