import type { InstallerPreflightRequest } from '@/lib/installer-preflight';
import { applyInstallerUrlOverride } from '@/lib/installer-url-overrides';
import type { Json } from '@/types/database';

export interface QaCandidatePreflightInput {
  winget_id: string;
  version: string;
  architecture: string;
  installer_url: string;
  installer_sha256: string;
  installer_type: string;
  test_config: Json;
}

function testConfigRecord(testConfig: Json): Record<string, Json | undefined> {
  return testConfig && typeof testConfig === 'object' && !Array.isArray(testConfig)
    ? testConfig as Record<string, Json | undefined>
    : {};
}

function canonicalProfileInstaller(
  testConfig: Record<string, Json | undefined>
): Record<string, unknown> {
  const canonicalJson = testConfig.packageProfileCanonicalJson;
  if (typeof canonicalJson !== 'string') return {};
  try {
    const profile = JSON.parse(canonicalJson) as { installer?: unknown } | null;
    const installer = profile?.installer;
    return installer && typeof installer === 'object' && !Array.isArray(installer)
      ? installer as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * Catalog candidates store their execution scope as `scope`. Customer
 * deployment-config candidates store it only inside the hashed canonical
 * package profile, which is the exact profile the VM executes. Reading only
 * `scope` treated every customer user-scope installer as machine scope, so
 * preflight rejected the trusted WinGet entry as MANIFEST_CHANGED.
 */
function candidateExecutionScope(testConfig: Record<string, Json | undefined>): 'machine' | 'user' {
  if (testConfig.scope === 'user' || testConfig.scope === 'machine') return testConfig.scope;
  return canonicalProfileInstaller(testConfig).installScope === 'user' ? 'user' : 'machine';
}

/** Build the exact installer preflight request that QA dispatch enforces. */
export function buildQaCandidatePreflightRequest(
  candidate: QaCandidatePreflightInput
): InstallerPreflightRequest {
  const testConfig = testConfigRecord(candidate.test_config);
  const sourceInstallerType = typeof testConfig.sourceInstallerType === 'string' && testConfig.sourceInstallerType.trim()
    ? testConfig.sourceInstallerType.trim()
    : candidate.installer_type;
  const executionInstallerUrl = applyInstallerUrlOverride(
    candidate.winget_id,
    candidate.version,
    candidate.architecture,
    candidate.installer_url,
  );

  return {
    wingetId: candidate.winget_id,
    version: candidate.version,
    architecture: candidate.architecture,
    installerUrl: executionInstallerUrl,
    manifestInstallerUrl: candidate.installer_url,
    installerSha256: candidate.installer_sha256,
    // The candidate column is the normalized execution type (for example,
    // WinGet Wix becomes MSI). Preflight must compare the original WinGet
    // manifest type or it will incorrectly quarantine a valid installer.
    installerType: sourceInstallerType,
    installScope: candidateExecutionScope(testConfig),
    sourceType: 'winget',
  };
}
