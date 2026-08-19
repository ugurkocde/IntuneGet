import { createHash } from 'node:crypto';
import { normalizeCatalogDetectionRules } from '@/lib/catalog-detection';
import { assertPackagingContract } from '@/lib/packaging-contract';
import type { DetectionRule } from '@/types/intune';
import { DEFAULT_PSADT_CONFIG, type PSADTConfig } from '@/types/psadt';
import {
  applyApplicationPackagingAdapter,
  resolveApplicationInstallScope,
  resolveApplicationUninstallCommand,
} from '@/lib/packaging-adapters';
import type { PackagedWingetDependency } from '@/lib/winget-dependencies';

export const QA_PSADT_TOOLCHAIN = {
  packagerRepository: 'ugurkocde/IntuneGet',
  packagerCommit: '837c54ac684d6a3d36a0ad5f14f258f8add540cf',
  packagerScriptPath: '.github/scripts/Create-PSADTPackage.ps1',
  psadtVersion: '4.1.8',
  templateUrl:
    'https://github.com/PSAppDeployToolkit/PSAppDeployToolkit/releases/download/4.1.8/PSAppDeployToolkit_Template_v4.zip',
  templateSha256: '50CB8D32973FC7648060A48CAD63912ECB5CACA5A70754F37E83AA06BD380283',
} as const;

/**
 * Successful catalog runs produced by these packager commits remain valid for
 * background coverage. Only add a commit when every change after it is limited
 * to a failure path that a passing package could not have exercised.
 *
 * Queued-candidate dispatch still requires the exact current package profile.
 * Customer demand can reuse an older pass only after its full execution
 * profile matches with the commit removed and every intervening release is
 * proven irrelevant to the behavior that profile exercises.
 */
export const QA_PACKAGER_RELEASE_HISTORY = [
  'de49775e759b693b92db09bc99aa116f197c4850',
  'c603eab9b8de23a6b5eb466f0fd8cdf2bfd04e33',
  '99edd0a9f4b7e10d4cc4272f90d763f3bd681440',
  'c1fe66c04b11f595bfaf4c9ca7cc1444186ea028',
  '42bf6e2af604a5e6bb44f2feff38e941ab2222c1',
  '430f817da1120f6a14f421b7016b628a06854aba',
  '66448ea49841c2c9f3ebf56e455ce8797e2b2abb',
  'ef75edee9fcabaf904bcf80e02ead9aa58490dc9',
  'fc18fffd40f6d362be251e05e2bc784373dfc735',
  'acfe2d8692cc2b910281236ff47d3ee5b2ce2b99',
  '354756f01cb572cfd410f95dd6af5ab3a9cb8efb',
  '267c8cbb3c520feaec04c2254de1a667b8fa90d4',
  'ca37c9eadd7b64d4d926f60a158e3dafb4554788',
  '93321ef6f7abd287f0fd6f37e37c5f4c199f3c4e',
  'f4bc37886e490ece525c701562869734a7e366d5',
  '9ff409ddabd3b1b4f8c65ad03b1f9e37778589fc',
  '7d389dbd6e55b719e3d71772717cda0c8f724469',
  '681b7510f7f30bec92c17581213c9ebc7f72765a',
  '7e83c363bcbafca153f00113b12ede2e332b2d2d',
  '670357c92fefa433036d8667dd5f382731d8326e',
  '2c40f49e2cb0b5a1f7a1c27996f5aee72553a074',
  'e6a4ae2f4f9a3a672c6912ab8e309483f53003b7',
  '2dca138ee2fe27dc45166dba536511aa80d8937e',
  '2eea7f106971cda783665a60eb4d0e25846dae46',
  '54515b6566ff4e7c9040fa24a8eba6b6347ef09e',
  'cf24633576b6c5efcca5fbde8ffe7fb4f0f57272',
  '2e68a941d3410e4eb7c6ed1e73fbc0eff290c807',
  'd0051e4b3972e9511935398e8b4f4e93e6289edd',
  '5f95d233998479791a49d1d784ea95137c098e73',
  '8235887e7126972b89c264e2053c1c4f7418ea74',
  '9214e4b5b71508bfba9aa1a2d4de5c3c771d3fea',
  '3fce249f5021c120a23ed0ab5dc726baaf060f3e',
  '4ca55ff8ac8d4d5f6d07665adbe06a07f0110006',
  '4ca2932ca8ff26578cade36457f0fcc150513e4c',
  '9f3105f568ec221fb672a53f1dbafdf01cd2e8b5',
  '34189c6876f0fe4539b971ba1b9e962ff66cd259',
  '0565fb456b7faf84cca56f2c988c99591015fe93',
  '77ed8d66246e8c7098f427e32d8488bc73f8eb3d',
  'c14531559086f83364ce69178369bf9462bcd872',
  '00fa68c7a24afe9db434cef87baa42455ed81fbb',
  '20e762d9c48a90881d9901c93d3f84f2d9474654',
  '719d7fd6db57ce5cbcecad528d53ae9c9088616f',
  '6db4e201f11e49bceb4d2729a2bc77fb0e675e89',
  '0c2765c26b69619df8f581190f4e67d97d79b589',
  '461c2757292d3b7bcde33682d3f7b33e566b1fea',
  '02f93d590887282aca0037412c8786785ddc6486',
  'ca77e52dc65a404eb81679c5188378bf4d69a692',
  'af4dfb94c9109ca598abc16a4b8cad57f6790066',
  '22b8e738d51a612f68b01c83b705d2dabc3bbcff',
  'cc143c874f2e84f06097cb199ad9998344040ded',
  // The .NET Framework registry-evidence release changed only its reviewed
  // adapter path. Preserve its passing result and every unrelated pass while
  // the Sonos-specific embedded-MSI lifecycle rolls out.
  '5569c16d136f464cbc014f40c70645414c601751',
  // The headless-extraction correction changes only the reviewed Sonos
  // adapter. Preserve Power Automate Desktop and all unrelated passing runs.
  '7c63f08735a32d428068d9e7fd467830096250a1',
  // The administrative-image correction changes only the reviewed Sonos
  // adapter. Preserve Mendeley Reference Manager and all unrelated passes.
  'e6dfe920d82e0b62c5d5e420fb603f61acdb5a42',
  // Preserve compatible passing coverage from the prior protected release.
  // The intervening changes repair reviewed failure paths while the exact
  // current profile remains mandatory for newly dispatched candidates.
  '81ad189d7e51026bd15681264f774f498429f526',
  // DWG FastView's reviewed silent-removal adapter changes only that vendor's
  // failed lifecycle. Preserve all compatible passes from the preceding
  // protected release while newly dispatched profiles use the exact pin.
  'f70f65692afddaf7b249cdacdcbacb356822f4f0',
  // The current DWG FastView silent-token correction remains confined to its
  // previously failing removal path. Preserve unrelated compatible passes.
  '4d9a1c9cae5383b6bf44f7501e4bb0dc157c7e3f',
  // Removing the ineffective DWG FastView adapter affects only an app now
  // blocked at the shared eligibility gate. Preserve every compatible pass.
  '02caa5a067569ad1d1e017fc6f52f3ee4e152120',
  // Visual Studio's managed-directory correction affects only 64-bit 2022+
  // instances. Preserve unrelated compatible passes from this release.
  '7870c214b74ac666b16573ac42cbc9e65a3848e2',
  // Build Tools 2022 remains below Program Files (x86), while the full 2022
  // IDE editions remain below Program Files. Preserve compatible passes.
  '1467e138d1e6f5f0cee3d8cda6f981c4d44f6b8f',
  // OpenWebStart's install4j uninstall adapter changes only that app's failed
  // lifecycle. Preserve compatible passes from the prior protected release.
  '82958ac0c0b39e06af14a87b70319251604910f7',
  // MSYS2's reviewed identity and official CLI removal affect only its failed
  // lifecycle. Preserve compatible passes from the prior protected release.
  '11933b94c72275551a565bed7364ebb8616e4414',
  // The MSYS2 correction preserves the reviewed path allowlist and changes
  // only its previously failing removal path. Preserve all compatible passes.
  '0b562aa574144a19a6b4c5e6c3d3d7a4c241961f',
  // Tor Browser's managed-directory adapter affects only its previously
  // failing no-ARP lifecycle. Malwarebytes is blocked at the shared
  // eligibility gate. Preserve every compatible pass from this release.
  'a48022baddf7b3f312541ef2e127220f508104a8',
  // Required WinGet install-location handling changes only profiles whose
  // arguments contain a target-machine environment token. Preserve every
  // unrelated compatible pass from the prior protected release.
  'fbb4aa2eed6cc545ec343373dd8947d04463a4a1',
  // The safe vendor-uninstall working directory changes only removal paths
  // that did not already pass. Filename normalization and dispatch budgeting
  // happen before execution, so preserve every compatible passing payload.
  '71ee706fe545cdcd8667545eb65e8ba62d82208c',
  // CutePDF's vendor-specific removal correction affects only its previously
  // failing unInstcpw helper. Preserve every unrelated compatible pass.
  '6af0cfac18f3c4653a69a01f41bc1170c1237807',
  // Autodesk Licensing Service uses its dedicated payload and documented
  // uninstaller instead of an ambiguous ARP delta. Preserve every unrelated
  // compatible pass from the preceding protected release.
  '12831539c9dc30678c6f16367faab76820502d2a',
  // Bria's process-close adapter affects only its previously failing MSI
  // removal path. Preserve every unrelated compatible passing result.
  'f426e369f2134ca5bb896170c9f7fd7e526c5916',
  // PotPlayer's all-users NSIS adapter affects only its previously failing
  // non-interactive install path. Bria and 3CX are blocked at the shared
  // eligibility gate, so preserve every unrelated compatible passing result.
  '16a626f329d93d1e499c1db30a243d9dc18a2aa6',
  // Appx provisioning heartbeats affect only machine-scoped packages whose
  // servicing operation remained silent long enough to hit the QA stall
  // detector. Preserve every previously passing package from this release.
  '77735e28d450c6b1c4f14a9a667bc5336eeeb3ea',
  // Logitech Presentation's reviewed scope correction affects only that
  // package's previously failing UAC path. Preserve every compatible pass
  // from the Appx provisioning heartbeat release.
  '7a8401469e353172b652259e731aa505cf8067bd',
  QA_PSADT_TOOLCHAIN.packagerCommit,
] as const;

export const QA_COMPATIBLE_PASSED_PACKAGER_COMMITS = [
  ...QA_PACKAGER_RELEASE_HISTORY,
].reverse();

/**
 * Increment this whenever profile-building semantics can change without changing a
 * canonical behavior field and there is no corresponding toolchain-pin change. A
 * scoped normalization that adds or rewrites a canonical field (such as repairing an
 * empty detection-rule list) invalidates only affected profiles through their hash and
 * does not require a global schema bump. Update the protected workflow verifier with
 * every schema bump so existing candidates fail closed before dispatch.
 */
export const QA_PACKAGE_PROFILE_SCHEMA_VERSION = 4;

export interface QaPackageProfileInput {
  profileKind: 'catalog-default' | 'deployment-config';
  wingetId: string;
  displayName: string;
  publisher: string;
  version: string;
  architecture: string;
  installerSha256: string;
  sourceInstallerType: string;
  silentArgs: string;
  successCodes?: readonly number[];
  uninstallCommand: string;
  installScope: string;
  nestedInstallerType: string;
  nestedInstallerFiles: readonly string[];
  psadtConfig: PSADTConfig;
  detectionRules: DetectionRule[];
  packageDependencies?: readonly PackagedWingetDependency[];
}

export interface QaPackageIdentity {
  profile: Record<string, unknown>;
  canonicalJson: string;
  /** Backwards-compatible name for the behavior-affecting execution profile. */
  packageProfileSha256: string;
  executionProfileSha256: string;
  presentationProfileSha256: string;
  psadtConfigSha256: string;
  detectionRulesSha256: string;
}

const PRESENTATION_PLACEHOLDER = 'IntuneGet QA';

/**
 * Split PSADT configuration into the fields that can change execution and the
 * fields that only change what a user sees. QA is deduplicated by execution;
 * presentation remains auditable on the packaging job without multiplying VM runs.
 */
export function splitQaPsadtConfig(config: PSADTConfig): {
  execution: PSADTConfig;
  presentation: Record<string, unknown>;
} {
  const presentation = {
    brandingCompanyName: config.brandingCompanyName,
    brandingWelcomeTitle: config.brandingWelcomeTitle,
    brandingWelcomeMessage: config.brandingWelcomeMessage,
    brandingAccentColor: config.brandingAccentColor,
    brandingLogoPath: config.brandingLogoPath,
    brandingLogoDarkPath: config.brandingLogoDarkPath,
    brandingBannerPath: config.brandingBannerPath,
    windowLocation: config.windowLocation,
    progressDialog: {
      statusMessage: config.progressDialog.statusMessage,
      windowLocation: config.progressDialog.windowLocation,
    },
    processesToClose: config.processesToClose.map(({ description }) => ({ description })),
    customPrompts: config.customPrompts.map((prompt) => ({
      title: prompt.title,
      message: prompt.message,
      icon: prompt.icon,
      buttonLeftText: prompt.buttonLeftText,
      buttonMiddleText: prompt.buttonMiddleText,
      buttonRightText: prompt.buttonRightText,
    })),
    balloonTips: config.balloonTips.map((tip) => ({
      title: tip.title,
      text: tip.text,
      icon: tip.icon,
    })),
  };

  const execution: PSADTConfig = {
    ...config,
    brandingCompanyName: undefined,
    brandingWelcomeTitle: undefined,
    brandingWelcomeMessage: undefined,
    brandingAccentColor: undefined,
    brandingLogoPath: undefined,
    brandingLogoDarkPath: undefined,
    brandingBannerPath: undefined,
    windowLocation: 'Default',
    progressDialog: {
      ...config.progressDialog,
      statusMessage: config.progressDialog.enabled ? PRESENTATION_PLACEHOLDER : undefined,
      windowLocation: undefined,
    },
    processesToClose: config.processesToClose.map(({ name }) => ({
      name,
      description: name,
    })),
    customPrompts: config.customPrompts.map((prompt) => ({
      ...prompt,
      title: PRESENTATION_PLACEHOLDER,
      message: PRESENTATION_PLACEHOLDER,
      icon: 'Information',
      buttonLeftText: prompt.buttonLeftText ? 'Left' : undefined,
      buttonMiddleText: prompt.buttonMiddleText ? 'Middle' : undefined,
      buttonRightText: prompt.buttonRightText ? 'Right' : undefined,
    })),
    balloonTips: config.balloonTips.map((tip) => ({
      ...tip,
      title: PRESENTATION_PLACEHOLDER,
      text: PRESENTATION_PLACEHOLDER,
      icon: 'Info',
    })),
  };

  return { execution, presentation };
}

export interface QaWorkflowPackageInput {
  wingetId: string;
  displayName: string;
  publisher: string;
  version: string;
  architecture?: string;
  installerSha256: string;
  installerType: string;
  nestedInstallerType?: string;
  nestedInstallerPath?: string;
  silentSwitches: string;
  installerSuccessCodes?: number[];
  uninstallCommand: string;
  installScope?: string;
  psadtConfig?: string;
  detectionRules?: string;
  packageDependencies?: readonly PackagedWingetDependency[];
}

export type QaPackageProfileValidation =
  | {
      valid: true;
      canonicalJson: string;
      packageProfileSha256: string;
    }
  | {
      valid: false;
      reason: string;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sha256(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-F0-9]{64}$/.test(normalized) ? normalized : '';
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function lowerTextValue(value: unknown): string {
  return textValue(value).toLowerCase();
}

function passingProfileCompatibilityReason(
  priorPackagerCommit: string,
  profile: Record<string, unknown>
): string | null {
  const priorIndex = QA_PACKAGER_RELEASE_HISTORY.indexOf(
    priorPackagerCommit as (typeof QA_PACKAGER_RELEASE_HISTORY)[number]
  );
  const currentIndex = QA_PACKAGER_RELEASE_HISTORY.indexOf(
    QA_PSADT_TOOLCHAIN.packagerCommit
  );
  if (priorIndex < 0 || currentIndex < 0 || priorIndex > currentIndex) {
    return 'compatible-packager-history-unknown';
  }

  const psadtConfig = record(profile.psadtConfig);
  if (!psadtConfig) return 'compatible-profile-invalid';
  const installer = record(profile.installer);
  if (!installer) return 'compatible-profile-invalid';
  const configuredProcesses = Array.isArray(psadtConfig.processesToClose)
    ? psadtConfig.processesToClose
    : [];

  for (const release of QA_PACKAGER_RELEASE_HISTORY.slice(priorIndex + 1, currentIndex + 1)) {
    // 42bf6e2 introduced the reviewed process-close lifecycle. A prior pass
    // with no configured process list remains valid; one that expected this
    // behavior must be exercised again. Later releases inherit the behavior
    // and must not repeatedly invalidate the same profile.
    if (
      release === '42bf6e2af604a5e6bb44f2feff38e941ab2222c1' &&
      configuredProcesses.length > 0
    ) {
      return 'compatible-process-lifecycle-changed';
    }

    // 66448ea corrected PSADT's zero-day deferral sentinel. Only profiles
    // that actually contain that value can exercise the changed branch.
    if (
      release === '66448ea49841c2c9f3ebf56e455ce8797e2b2abb' &&
      psadtConfig.deferDays === 0
    ) {
      return 'compatible-zero-day-deferral-changed';
    }

    // 71ee706 expands WinGet install-location environment variables inside
    // the target VM. A prior pass without such a token cannot exercise this
    // branch and remains compatible.
    if (
      release === '71ee706fe545cdcd8667545eb65e8ba62d82208c' &&
      /%[A-Za-z][A-Za-z0-9()_]*%/.test(textValue(installer.silentArgs))
    ) {
      return 'compatible-install-location-expansion-changed';
    }
  }

  return null;
}

function profileWithoutPackagerCommit(profile: Record<string, unknown>): Record<string, unknown> {
  const toolchain = record(profile.toolchain);
  return {
    ...profile,
    toolchain: toolchain
      ? Object.fromEntries(
          Object.entries(toolchain).filter(([field]) => field !== 'packagerCommit')
        )
      : toolchain,
  };
}

function normalizeForJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeForJson(entry)])
    );
  }
  return value;
}

export function canonicalQaJson(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

export function qaSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

/**
 * Validates that a queued package candidate was produced by the complete current QA toolchain.
 * The hash is calculated over the stored canonical string itself; parsing and re-serializing it
 * would make the result dependent on object key order.
 */
type QaPackageProfileValidationInput = {
  testConfig: unknown;
  candidatePackageProfileSha256: unknown;
  candidateWingetId: unknown;
  candidateVersion: unknown;
  candidateArchitecture: unknown;
  candidateInstallerSha256: unknown;
};

function validateQaPackageProfile(
  input: QaPackageProfileValidationInput,
  acceptedPackagerCommits: readonly string[]
): QaPackageProfileValidation {
  const config = record(input.testConfig);
  if (!config) return { valid: false, reason: 'test-config-invalid' };
  if (config.profileKind !== 'catalog-default' && config.profileKind !== 'deployment-config') {
    return { valid: false, reason: 'wrong-profile-kind' };
  }

  const canonicalJson =
    typeof config.packageProfileCanonicalJson === 'string'
      ? config.packageProfileCanonicalJson
      : '';
  if (!canonicalJson) return { valid: false, reason: 'canonical-json-missing' };

  let profile: Record<string, unknown> | null = null;
  try {
    profile = record(JSON.parse(canonicalJson));
  } catch {
    return { valid: false, reason: 'canonical-json-invalid' };
  }
  if (!profile) return { valid: false, reason: 'canonical-json-invalid' };
  if (profile.schemaVersion !== QA_PACKAGE_PROFILE_SCHEMA_VERSION) {
    return { valid: false, reason: 'canonical-schema-version-mismatch' };
  }
  if (profile.testLevel !== 'psadt-package') {
    return { valid: false, reason: 'canonical-test-level-mismatch' };
  }
  if (profile.profileKind !== config.profileKind) {
    return { valid: false, reason: 'canonical-profile-kind-mismatch' };
  }

  const calculatedSha256 = qaSha256(canonicalJson);
  const configSha256 = sha256(config.packageProfileSha256);
  if (!configSha256) return { valid: false, reason: 'config-profile-sha-invalid' };
  if (configSha256 !== calculatedSha256) {
    return { valid: false, reason: 'config-profile-sha-mismatch' };
  }
  const candidateSha256 = sha256(input.candidatePackageProfileSha256);
  if (!candidateSha256) return { valid: false, reason: 'candidate-profile-sha-invalid' };
  if (candidateSha256 !== calculatedSha256) {
    return { valid: false, reason: 'candidate-profile-sha-mismatch' };
  }

  const toolchain = record(profile.toolchain);
  if (!toolchain) return { valid: false, reason: 'toolchain-missing' };
  for (const [field, expected] of Object.entries(QA_PSADT_TOOLCHAIN)) {
    if (field === 'packagerCommit') {
      if (!acceptedPackagerCommits.includes(textValue(toolchain[field]))) {
        return { valid: false, reason: `toolchain-mismatch:${field}` };
      }
      continue;
    }
    if (toolchain[field] !== expected) {
      return { valid: false, reason: `toolchain-mismatch:${field}` };
    }
  }

  const embeddedPsadtConfigSha256 = sha256(profile.psadtConfigSha256);
  if (!embeddedPsadtConfigSha256) {
    return { valid: false, reason: 'canonical-psadt-config-sha-invalid' };
  }
  if (embeddedPsadtConfigSha256 !== qaSha256(canonicalQaJson(profile.psadtConfig))) {
    return { valid: false, reason: 'canonical-psadt-config-sha-mismatch' };
  }
  const embeddedDetectionRulesSha256 = sha256(profile.detectionRulesSha256);
  if (!embeddedDetectionRulesSha256) {
    return { valid: false, reason: 'canonical-detection-rules-sha-invalid' };
  }
  if (embeddedDetectionRulesSha256 !== qaSha256(canonicalQaJson(profile.detectionRules))) {
    return { valid: false, reason: 'canonical-detection-rules-sha-mismatch' };
  }

  const app = record(profile.app);
  if (!app) return { valid: false, reason: 'canonical-app-missing' };
  const canonicalWingetId = lowerTextValue(app.wingetId);
  const candidateWingetId = lowerTextValue(input.candidateWingetId);
  if (!canonicalWingetId) return { valid: false, reason: 'canonical-winget-id-invalid' };
  if (!candidateWingetId) return { valid: false, reason: 'candidate-winget-id-invalid' };
  if (canonicalWingetId !== candidateWingetId) {
    return { valid: false, reason: 'candidate-winget-id-mismatch' };
  }
  const canonicalVersion = textValue(app.version);
  const candidateVersion = textValue(input.candidateVersion);
  if (!canonicalVersion) return { valid: false, reason: 'canonical-version-invalid' };
  if (!candidateVersion) return { valid: false, reason: 'candidate-version-invalid' };
  if (canonicalVersion !== candidateVersion) {
    return { valid: false, reason: 'candidate-version-mismatch' };
  }
  const canonicalArchitecture = lowerTextValue(app.architecture);
  const candidateArchitecture = lowerTextValue(input.candidateArchitecture);
  if (!canonicalArchitecture) {
    return { valid: false, reason: 'canonical-architecture-invalid' };
  }
  if (!candidateArchitecture) {
    return { valid: false, reason: 'candidate-architecture-invalid' };
  }
  if (canonicalArchitecture !== candidateArchitecture) {
    return { valid: false, reason: 'candidate-architecture-mismatch' };
  }
  const installer = record(profile.installer);
  if (!installer) return { valid: false, reason: 'canonical-installer-missing' };
  const canonicalInstallerSha256 = sha256(installer.sha256);
  const candidateInstallerSha256 = sha256(input.candidateInstallerSha256);
  if (!canonicalInstallerSha256) {
    return { valid: false, reason: 'canonical-installer-sha-invalid' };
  }
  if (!candidateInstallerSha256) {
    return { valid: false, reason: 'candidate-installer-sha-invalid' };
  }
  if (canonicalInstallerSha256 !== candidateInstallerSha256) {
    return { valid: false, reason: 'candidate-installer-sha-mismatch' };
  }
  if (installer.packageDependencies !== undefined) {
    if (!Array.isArray(installer.packageDependencies) || installer.packageDependencies.length === 0) {
      return { valid: false, reason: 'canonical-dependencies-invalid' };
    }
    const dependencySha256 = sha256(installer.dependenciesSha256);
    if (!dependencySha256) {
      return { valid: false, reason: 'canonical-dependencies-sha-invalid' };
    }
    if (
      dependencySha256 !== qaSha256(canonicalQaJson(installer.packageDependencies))
    ) {
      return { valid: false, reason: 'canonical-dependencies-sha-mismatch' };
    }
    for (const dependencyValue of installer.packageDependencies) {
      const dependency = record(dependencyValue);
      if (
        !dependency ||
        !textValue(dependency.packageIdentifier) ||
        !textValue(dependency.version) ||
        !sha256(dependency.sha256) ||
        !textValue(dependency.fileName)
      ) {
        return { valid: false, reason: 'canonical-dependency-entry-invalid' };
      }
    }
  }

  return {
    valid: true,
    canonicalJson,
    packageProfileSha256: calculatedSha256,
  };
}

export function validateCurrentQaPackageProfile(
  input: QaPackageProfileValidationInput
): QaPackageProfileValidation {
  return validateQaPackageProfile(input, [QA_PSADT_TOOLCHAIN.packagerCommit]);
}

export function validateCompatiblePassedCatalogQaProfile(
  input: QaPackageProfileValidationInput
): QaPackageProfileValidation {
  const validation = validateQaPackageProfile(
    input,
    QA_COMPATIBLE_PASSED_PACKAGER_COMMITS
  );
  if (!validation.valid || !validation.canonicalJson) return validation;

  // A passed result remains reusable through a later release only when none
  // of the intervening changes can alter the behavior that profile exercises.
  // This is release-aware: a process-close profile tested after the lifecycle
  // release is not invalidated again by every later unrelated packager fix.
  const profile = record(JSON.parse(validation.canonicalJson));
  const toolchain = record(profile?.toolchain);
  const priorPackagerCommit = textValue(toolchain?.packagerCommit);
  if (priorPackagerCommit === QA_PSADT_TOOLCHAIN.packagerCommit) {
    return validation;
  }

  const compatibilityReason = profile
    ? passingProfileCompatibilityReason(priorPackagerCommit, profile)
    : 'compatible-profile-invalid';
  if (compatibilityReason) return { valid: false, reason: compatibilityReason };

  const psadtConfig = record(profile?.psadtConfig);
  const app = record(profile?.app);
  const wingetId = textValue(app?.wingetId);
  if (!wingetId || !psadtConfig) {
    return { valid: false, reason: 'compatible-profile-invalid' };
  }
  const typedPsadtConfig = psadtConfig as unknown as PSADTConfig;
  const adapted = applyApplicationPackagingAdapter(wingetId, typedPsadtConfig);
  if (canonicalQaJson(adapted) !== canonicalQaJson(typedPsadtConfig)) {
    return { valid: false, reason: 'compatible-application-adapter-changed' };
  }

  return validation;
}

export function validateCompatiblePassedDeploymentQaProfile(input: {
  prior: QaPackageProfileValidationInput;
  currentCanonicalJson: string;
  currentPackageProfileSha256: string;
}): QaPackageProfileValidation {
  const priorValidation = validateQaPackageProfile(
    input.prior,
    QA_COMPATIBLE_PASSED_PACKAGER_COMMITS
  );
  if (!priorValidation.valid || !priorValidation.canonicalJson) return priorValidation;

  let priorProfile: Record<string, unknown> | null = null;
  let currentProfile: Record<string, unknown> | null = null;
  try {
    priorProfile = record(JSON.parse(priorValidation.canonicalJson));
    currentProfile = record(JSON.parse(input.currentCanonicalJson));
  } catch {
    return { valid: false, reason: 'compatible-profile-invalid' };
  }
  if (!priorProfile || !currentProfile) {
    return { valid: false, reason: 'compatible-profile-invalid' };
  }
  if (priorProfile.profileKind !== 'deployment-config' || currentProfile.profileKind !== 'deployment-config') {
    return { valid: false, reason: 'compatible-profile-kind-mismatch' };
  }
  if (qaSha256(input.currentCanonicalJson) !== sha256(input.currentPackageProfileSha256)) {
    return { valid: false, reason: 'compatible-current-profile-sha-mismatch' };
  }
  const currentToolchain = record(currentProfile.toolchain);
  if (textValue(currentToolchain?.packagerCommit) !== QA_PSADT_TOOLCHAIN.packagerCommit) {
    return { valid: false, reason: 'compatible-current-packager-mismatch' };
  }

  const priorComparable = canonicalQaJson(profileWithoutPackagerCommit(priorProfile));
  const currentComparable = canonicalQaJson(profileWithoutPackagerCommit(currentProfile));
  if (priorComparable !== currentComparable) {
    return { valid: false, reason: 'compatible-execution-profile-changed' };
  }

  const priorToolchain = record(priorProfile.toolchain);
  const compatibilityReason = passingProfileCompatibilityReason(
    textValue(priorToolchain?.packagerCommit),
    priorProfile
  );
  if (compatibilityReason) return { valid: false, reason: compatibilityReason };

  return priorValidation;
}

export function normalizeQaPsadtConfig(
  value: Partial<PSADTConfig> | null | undefined,
  detectionRules: DetectionRule[]
): PSADTConfig {
  return {
    ...DEFAULT_PSADT_CONFIG,
    ...(value || {}),
    processesToClose: value?.processesToClose || [],
    progressDialog: {
      ...DEFAULT_PSADT_CONFIG.progressDialog,
      ...(value?.progressDialog || {}),
    },
    customPrompts: value?.customPrompts || [],
    restartPrompt: {
      ...DEFAULT_PSADT_CONFIG.restartPrompt,
      ...(value?.restartPrompt || {}),
    },
    balloonTips: value?.balloonTips || [],
    detectionRules,
    postInstallCommands: value?.postInstallCommands || [],
    postUninstallCommands: value?.postUninstallCommands || [],
    reviewedInstallArguments: value?.reviewedInstallArguments || [],
    reviewedInstallArgumentsOverride: value?.reviewedInstallArgumentsOverride,
    reviewedUninstallArguments: value?.reviewedUninstallArguments || [],
  };
}

export function buildQaPackageIdentity(input: QaPackageProfileInput): QaPackageIdentity {
  const { execution: executionPsadtConfig, presentation } = splitQaPsadtConfig(
    input.psadtConfig
  );
  const psadtConfigSha256 = qaSha256(canonicalQaJson(executionPsadtConfig));
  const presentationProfileSha256 = qaSha256(canonicalQaJson({
    app: { displayName: input.displayName, publisher: input.publisher },
    psadt: presentation,
  }));
  const detectionRulesSha256 = qaSha256(canonicalQaJson(input.detectionRules));
  const packageDependencies = (input.packageDependencies || []).map((dependency) => ({
    packageIdentifier: dependency.packageIdentifier,
    ...(dependency.minimumVersion
      ? { minimumVersion: dependency.minimumVersion }
      : {}),
    version: dependency.version,
    architecture: dependency.architecture,
    sha256: dependency.installerSha256.toUpperCase(),
    installerType: dependency.installerType,
    ...(dependency.nestedInstallerType
      ? { nestedInstallerType: dependency.nestedInstallerType }
      : {}),
    ...(dependency.nestedInstallerPath
      ? { nestedInstallerPath: dependency.nestedInstallerPath }
      : {}),
    silentArgs: dependency.silentArgs,
    successCodes: dependency.successCodes,
    rebootCodes: dependency.rebootCodes,
    fileName: dependency.fileName,
    order: dependency.order,
  }));
  const dependenciesSha256 = packageDependencies.length > 0
    ? qaSha256(canonicalQaJson(packageDependencies))
    : '';
  const profile = {
    schemaVersion: QA_PACKAGE_PROFILE_SCHEMA_VERSION,
    testLevel: 'psadt-package',
    profileKind: input.profileKind,
    toolchain: QA_PSADT_TOOLCHAIN,
    app: {
      wingetId: input.wingetId,
      displayName: input.profileKind === 'deployment-config' ? input.wingetId : input.displayName,
      publisher: input.profileKind === 'deployment-config' ? 'IntuneGet QA' : input.publisher,
      version: input.version,
      architecture: input.architecture.toLowerCase(),
    },
    installer: {
      sha256: input.installerSha256.toUpperCase(),
      sourceType: input.sourceInstallerType.toLowerCase(),
      silentArgs: input.silentArgs,
      ...(normalizeSuccessCodes(input.successCodes).length > 0
        ? { successCodes: normalizeSuccessCodes(input.successCodes) }
        : {}),
      uninstallCommand: input.uninstallCommand,
      installScope: input.installScope || 'machine',
      nestedInstallerType: input.nestedInstallerType.toLowerCase(),
      nestedInstallerFiles: input.nestedInstallerFiles,
      ...(packageDependencies.length > 0
        ? { packageDependencies, dependenciesSha256 }
        : {}),
    },
    psadtConfig: executionPsadtConfig,
    detectionRules: input.detectionRules,
    psadtConfigSha256,
    detectionRulesSha256,
  };
  const canonicalJson = canonicalQaJson(profile);
  const executionProfileSha256 = qaSha256(canonicalJson);
  return {
    profile,
    canonicalJson,
    packageProfileSha256: executionProfileSha256,
    executionProfileSha256,
    presentationProfileSha256,
    psadtConfigSha256,
    detectionRulesSha256,
  };
}

function parseJsonObject<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeSuccessCodes(value: readonly number[] | undefined): number[] {
  return Array.from(new Set((value || [])
    .map((code) => Number(code))
    .filter((code) => Number.isInteger(code) && code >= 0 && code <= 65535)))
    .sort((left, right) => left - right);
}

export function normalizeQaWorkflowPackageInput(input: QaWorkflowPackageInput): {
  detectionRules: DetectionRule[];
  psadtConfig: PSADTConfig;
  detectionRulesJson: string;
  psadtConfigJson: string;
  uninstallCommand: string;
  identity: QaPackageIdentity;
} {
  assertPackagingContract({
    wingetId: input.wingetId,
    installerType: input.installerType,
    silentArgs: input.silentSwitches,
    nestedInstallerType: input.nestedInstallerType,
    nestedInstallerFiles: input.nestedInstallerPath ? [input.nestedInstallerPath] : [],
  });
  const parsedDetectionRulesValue = parseJsonObject<unknown>(input.detectionRules, []);
  const parsedDetectionRules = Array.isArray(parsedDetectionRulesValue)
    ? (parsedDetectionRulesValue as DetectionRule[])
    : [];
  const parsedConfig = parseJsonObject<unknown>(input.psadtConfig, {});
  const rawConfig = (record(parsedConfig) || {}) as Partial<PSADTConfig>;
  const preliminaryConfig = normalizeQaPsadtConfig(rawConfig, parsedDetectionRules);
  const installScope = resolveApplicationInstallScope(
    input.wingetId,
    input.installScope || 'machine'
  );
  const detectionRules = normalizeCatalogDetectionRules({
    detectionRules: parsedDetectionRules,
    fallbackDetectionRules: rawConfig.detectionRules,
    wingetId: input.wingetId,
    version: input.version,
    installScope,
    markerPath: preliminaryConfig.registryMarkerPath,
    installerType: input.nestedInstallerType || input.installerType,
  });
  const psadtConfig = applyApplicationPackagingAdapter(
    input.wingetId,
    normalizeQaPsadtConfig(rawConfig, detectionRules)
  );
  const uninstallCommand = resolveApplicationUninstallCommand(
    input.wingetId,
    input.uninstallCommand
  );
  const identity = buildQaPackageIdentity({
    profileKind: 'deployment-config',
    wingetId: input.wingetId,
    displayName: input.displayName,
    publisher: input.publisher,
    version: input.version,
    architecture: input.architecture || 'x64',
    installerSha256: input.installerSha256,
    sourceInstallerType: input.installerType,
    silentArgs: input.silentSwitches,
    successCodes: input.installerSuccessCodes,
    uninstallCommand,
    installScope,
    nestedInstallerType: input.nestedInstallerType || '',
    nestedInstallerFiles: input.nestedInstallerPath ? [input.nestedInstallerPath] : [],
    psadtConfig,
    detectionRules,
    packageDependencies: input.packageDependencies,
  });

  return {
    detectionRules,
    psadtConfig,
    detectionRulesJson: JSON.stringify(detectionRules),
    psadtConfigJson: JSON.stringify(psadtConfig),
    uninstallCommand,
    identity,
  };
}

export function buildQaPackageIdentityFromWorkflowInput(
  input: QaWorkflowPackageInput
): QaPackageIdentity {
  return normalizeQaWorkflowPackageInput(input).identity;
}
