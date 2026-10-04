import { createCuratedVerificationProfile, CURATED_APPS } from './verification-profile';
import { CuratedCatalogError, validateCandidate, validateRelease } from './core.mjs';
import { compatiblePriorExecutionProfileReason, qaSha256 } from '@/lib/qa/package-profile';
import type { CuratedAppDefinition, CuratedCandidate, CuratedRelease } from './types';

const REPOSITORY = 'ugurkocde/IntuneGet-Workflows';
const WORKFLOW = '.github/workflows/curated-catalog-verification.yml';
/** The approval identity recorded on every release signed by the automation. */
export const AUTOMATED_APPROVER = 'github-actions:ugurkocde/IntuneGet/.github/workflows/curated-catalog-automation.yml';
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
  // The run may have used an earlier packager release than the one current at
  // approval. Its exact tested profile must still be compatible.
  const tested = report.qa.executionProfileSha256;
  requireValue(typeof tested === 'string' && report.profile.executionProfileSha256 === tested &&
    qaSha256(report.profile.packageProfileCanonicalJson).toLowerCase() === tested.toLowerCase() &&
    compatiblePriorExecutionProfileReason(profile.packageProfileCanonicalJson, report.qa.packagerCommit, tested) === null &&
    report.qa.candidateId === report.candidate.id &&
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
    executionProfileSha256: tested,
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

/**
 * Automated approval policy. Every evidence check in releaseFromVerification
 * still applies; the exceptions that a maintainer used to type are instead
 * fixed by reviewed code and definitions, so they are identical every time.
 */
export function automatedApprovalExceptions(app: CuratedAppDefinition, report: Pick<VerificationReport, 'previous' | 'inspection'>) {
  return {
    unsignedException: report.inspection.current.signature.status === 'unsigned' ? app.unsignedExceptionReason : undefined,
    upgradeException: report.previous === null
      ? `Automated policy: ${app.name} is updated by its publisher's own updater, and no earlier immutable official installer was available, so the upgrade was not tested.`
      : undefined,
  };
}
