import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { Json } from '@/types/database';
import type { PackagedWingetDependency } from '@/lib/winget-dependencies';
import type { normalizeQaWorkflowPackageInput } from './package-profile';

export const QA_DEPLOYMENT_TEST_PSADT_CONFIG = {
  ...DEFAULT_PSADT_CONFIG,
  deployMode: 'Auto',
  progressDialog: {
    enabled: true,
    statusMessage: 'IntuneGet is validating this application package.',
    windowLocation: 'BottomRight',
  },
};

export function buildQaDeploymentTestConfig(
  normalized: ReturnType<typeof normalizeQaWorkflowPackageInput>,
  dependencies: readonly PackagedWingetDependency[],
) {
  const { identity } = normalized;
  return {
    mode: 'psadt-package',
    profileKind: 'deployment-config',
    ...(dependencies.length ? { packageDependencies: dependencies as unknown as Json } : {}),
    packageProfileCanonicalJson: identity.canonicalJson,
    packageProfileSha256: identity.packageProfileSha256,
    executionProfileSha256: identity.packageProfileSha256,
    presentationProfileSha256: identity.presentationProfileSha256,
    psadtConfigSha256: identity.psadtConfigSha256,
    detectionRulesSha256: identity.detectionRulesSha256,
    // The canonical identity omits presentation; the isolated VM uses fixed QA presentation.
    psadtConfig: normalized.psadtConfig as unknown as Json,
    detectionRules: normalized.detectionRules as unknown as Json,
  };
}
