import { createCuratedVerificationProfile, CURATED_APPS } from './verification-profile';
import { CuratedCatalogError, validateCandidate, validateRelease } from './core.mjs';
import type { CuratedCandidate, CuratedRelease } from './types';

const REPOSITORY = 'ugurkocde/IntuneGet-Workflows';
const WORKFLOW = '.github/workflows/curated-catalog-verification.yml';
export interface VerificationRun {
  id: number; run_attempt: number; repository: { full_name: string };
  path: string; event: string; status: string; conclusion: string;
  head_branch: string; head_sha: string;
}
export interface VerificationArtifact {
  id: number; name: string; expired: boolean; digest: string;
  workflow_run: { id: number; head_sha: string };
}
export interface VerificationReport {
  schemaVersion: number; status: string; vmRestored: boolean; verifiedAt: string;
  provenance: { repository: string; workflowPath: string; workflowCommit: string; runId: string; runAttempt: string; websiteCommit: string };
  /** Null when no earlier official build was supplied and the upgrade test was skipped. */
  candidate: CuratedCandidate; previous: CuratedCandidate | null;
  inspection: { current: Inspection; previous?: Inspection };
  profile: ReturnType<typeof createCuratedVerificationProfile>;
  qa: Omit<CuratedRelease['evidence']['qa'], 'upgrade'> & { candidateId: string; installerVersion: string; architecture: string; previousInstallerSha256?: string; upgrade?: { tested: false } };
}
interface Inspection {
  candidateId: string; installerSha256: string; sourceUrl: string; finalOrigin: string;
  signature: CuratedRelease['evidence']['signature']; security: CuratedRelease['evidence']['security'];
}
const requireValue = (condition: unknown, message: string) => {
  if (!condition) throw new CuratedCatalogError(message);
};

/** API metadata must be fetched by the protected workflow, never read from the report. */
export function releaseFromVerification(report: VerificationReport, run: VerificationRun, artifact: VerificationArtifact,
  context: { websiteCommit: string; artifactSha256: string; approvedBy: string; approvedAt: string; unsignedException?: string; upgradeException?: string }) {
  requireValue(run.repository.full_name === REPOSITORY && run.path.split('@')[0] === WORKFLOW &&
    run.event === 'workflow_dispatch' && run.head_branch === 'main' && run.status === 'completed' && run.conclusion === 'success', 'Only a successful protected curated verification run can qualify a release.');
  requireValue(Number.isSafeInteger(artifact.id) && artifact.id > 0 && artifact.name === 'curated-verification-evidence' && !artifact.expired &&
    artifact.workflow_run.id === run.id && artifact.workflow_run.head_sha === run.head_sha &&
    artifact.digest === `sha256:${context.artifactSha256}`, 'Verification artifact provenance or checksum does not match the run.');
  requireValue(report.schemaVersion === 1 && report.status === 'passed' && report.vmRestored === true &&
    report.provenance.repository === REPOSITORY && report.provenance.workflowPath === WORKFLOW && report.provenance.workflowCommit === run.head_sha &&
    report.provenance.runId === String(run.id) && report.provenance.runAttempt === String(run.run_attempt) &&
    report.provenance.websiteCommit === context.websiteCommit, 'Verification report provenance or VM restoration is invalid.');
  const app = CURATED_APPS.find(app => app.id === report.candidate?.appId);
  requireValue(app, 'Unknown verification app.');
  if (!app) throw new CuratedCatalogError('Unknown verification app.');
  const previous = report.previous;
  if (previous !== null) validateCandidate(app, previous);
  validateCandidate(app, report.candidate);
  const upgradeException = context.upgradeException?.trim() ? context.upgradeException : undefined;
  const { upgrade: reportedUpgrade, ...reportedQa } = report.qa;
  if (previous === null) {
    // Approved policy: an app whose own updater handles upgrades may qualify
    // without an upgrade test when no older official build exists. The skip
    // must be recorded by QA and explained by the reviewing maintainer.
    requireValue(app.autoUpdate === 'vendor-managed', 'Only vendor-managed apps may qualify without an upgrade from an earlier release.');
    requireValue(report.inspection.previous === undefined && reportedUpgrade?.tested === false && Object.keys(reportedUpgrade).length === 1 &&
      report.qa.upgradeFromVersion === undefined && report.qa.previousInstallerSha256 === undefined, 'The verification report must explicitly record that the upgrade was not tested.');
    requireValue(typeof upgradeException === 'string' && upgradeException.trim().length >= 20, 'The maintainer must explicitly review and explain why the upgrade was not tested.');
  } else {
    requireValue(reportedUpgrade === undefined, 'A supplied earlier release must be upgrade tested.');
    requireValue(upgradeException === undefined, 'An upgrade exemption applies only when no earlier release was tested.');
  }
  const inspections: Array<[CuratedCandidate, Inspection | undefined]> = [[report.candidate, report.inspection.current]];
  if (previous !== null) inspections.push([previous, report.inspection.previous]);
  for (const [candidate, inspection] of inspections) {
    if (!inspection) throw new CuratedCatalogError('Every tested installer requires inspection evidence.');
    requireValue(inspection.candidateId === candidate.id && inspection.sourceUrl === candidate.installerUrl &&
      /^[a-f0-9]{64}$/.test(inspection.installerSha256) && (!candidate.vendorSha256 || candidate.vendorSha256 === inspection.installerSha256), 'Inspection does not match the exact publisher candidate.');
    requireValue(inspection.security.status === 'clean' && inspection.security.scanner === 'defender' && inspection.security.malicious === 0 &&
      inspection.security.suspicious === 0 && inspection.security.installerSha256 === inspection.installerSha256, 'Every tested installer must have clean exact-hash security evidence.');
    requireValue((inspection.signature.status === 'valid' && app.signaturePublishers.includes(inspection.signature.publisher || '')) ||
      (app.allowUnsigned && inspection.signature.status === 'unsigned' && inspection.signature.publisher === null), 'Every tested installer must satisfy the publisher signature policy.');
  }
  const measured = report.inspection.current.installerSha256;
  const profile = createCuratedVerificationProfile(report.candidate, measured);
  requireValue(report.profile.executionProfileSha256 === profile.executionProfileSha256 && report.profile.packageProfileCanonicalJson === profile.packageProfileCanonicalJson &&
    report.qa.executionProfileSha256 === profile.executionProfileSha256 && report.qa.candidateId === report.candidate.id &&
    report.qa.installerSha256 === measured && (previous === null || (report.qa.previousInstallerSha256 === report.inspection.previous?.installerSha256 &&
    report.qa.upgradeFromVersion === previous.version)) && report.qa.installerVersion === report.candidate.version && report.qa.architecture === app.architecture, 'QA did not exercise the current production profile and every exact installer.');
  const reportUrl = `https://github.com/ugurkocde/IntuneGet/blob/main/catalog/curated/evidence/${app.id}/${report.candidate.id}.json`;
  const signature = { ...report.inspection.current.signature };
  if (signature.status === 'unsigned') {
    requireValue(typeof context.unsignedException === 'string' && context.unsignedException.trim().length >= 20, 'The maintainer must explicitly review and explain the unsigned installer exception.');
    signature.exceptionReason = context.unsignedException;
  }
  const release: CuratedRelease = {
    id: `${app.id}:${report.candidate.id}`, candidate: report.candidate, installerSha256: measured,
    executionProfileSha256: profile.executionProfileSha256,
    preparedBy: `github-actions:${REPOSITORY}/${WORKFLOW}`, approvedBy: context.approvedBy, approvedAt: context.approvedAt,
    evidence: {
      verifiedAt: report.verifiedAt, installerSha256: measured, installerVersion: report.qa.installerVersion, architecture: app.architecture,
      sourceReviewedBy: context.approvedBy, sourceReportUrl: reportUrl, signature,
      provenance: { repository: REPOSITORY, workflowPath: WORKFLOW, workflowCommit: run.head_sha, websiteCommit: context.websiteCommit,
        runId: String(run.id), runAttempt: run.run_attempt, artifactId: String(artifact.id), artifactSha256: context.artifactSha256 },
      security: { ...report.inspection.current.security, reportUrl },
      qa: previous === null ? { ...reportedQa, upgrade: { tested: false, reason: upgradeException! }, reportUrl } : { ...reportedQa, reportUrl },
    },
  };
  validateRelease(app, release);
  return release;
}

export function authenticatedCatalogReviewer(reviews: Array<{ state: string; environments: Array<{ name: string }>; user: { id: number; login: string; type: string } }>,
  environment: { can_admins_bypass: boolean; protection_rules: Array<{ type: string; reviewers?: Array<{ type: string; reviewer: { id: number } }> }> }) {
  const required = environment.protection_rules.find(rule => rule.type === 'required_reviewers');
  requireValue(environment.can_admins_bypass === false && required?.reviewers?.length, 'Signing requires an environment with required reviewers and no administrator bypass.');
  const approved = [...reviews].reverse().find(review => review.state === 'approved' &&
    review.environments.some(env => env.name === 'curated-catalog-approval') && review.user.type === 'User' &&
    required?.reviewers?.some(reviewer => reviewer.type === 'User' && reviewer.reviewer.id === review.user.id));
  requireValue(approved, 'A real required maintainer must approve the signing environment.');
  return approved!.user.login;
}
