import { CURATED_APPS } from './definitions';
import { CuratedCatalogError, validateCandidate } from './core.mjs';
import { buildCuratedCartItem, curatedWorkflowInput } from './package';
import { normalizeQaWorkflowPackageInput, QA_PSADT_TOOLCHAIN } from '@/lib/qa/package-profile';
import type { CuratedCandidate, CuratedRelease } from './types';

// Shared by the operator endpoint and the standalone protected QA runtime.
// This function produces test inputs; it cannot authorize deployment.
export function createCuratedVerificationProfile(candidate: CuratedCandidate, installerSha256: string) {
  const app = CURATED_APPS.find(app => app.id === candidate?.appId);
  if (!app) throw new CuratedCatalogError('Unknown curated app.');
  validateCandidate(app, candidate);
  if (typeof installerSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(installerSha256) ||
      (candidate.vendorSha256 && candidate.vendorSha256.toLowerCase() !== installerSha256.toLowerCase())) {
    throw new CuratedCatalogError('A matching verified installer SHA256 is required.');
  }
  const draft = { id: `${app.id}:${candidate.id}`, candidate, installerSha256 } as CuratedRelease;
  const input = curatedWorkflowInput(buildCuratedCartItem(app, draft));
  const normalized = normalizeQaWorkflowPackageInput(input);
  return {
    candidateId: candidate.id,
    packageId: app.packageId,
    installerUrl: candidate.installerUrl,
    installerSha256,
    workflowInput: { ...input, psadtConfig: normalized.psadtConfigJson, detectionRules: normalized.detectionRulesJson, uninstallCommand: normalized.uninstallCommand },
    executionProfileSha256: normalized.identity.executionProfileSha256,
    packageProfileCanonicalJson: normalized.identity.canonicalJson,
    packagerCommit: QA_PSADT_TOOLCHAIN.packagerCommit,
    approvalRequired: true as const,
  };
}

export { CURATED_APPS, QA_PSADT_TOOLCHAIN };
