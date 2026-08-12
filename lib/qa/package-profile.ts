import { createHash } from 'node:crypto';
import { normalizeCatalogDetectionRules } from '@/lib/catalog-detection';
import { assertPackagingContract } from '@/lib/packaging-contract';
import type { DetectionRule } from '@/types/intune';
import { DEFAULT_PSADT_CONFIG, type PSADTConfig } from '@/types/psadt';
import { applyApplicationPackagingAdapter } from '@/lib/packaging-adapters';
import type { PackagedWingetDependency } from '@/lib/winget-dependencies';

export const QA_PSADT_TOOLCHAIN = {
  packagerRepository: 'ugurkocde/IntuneGet',
  packagerCommit: '1b130924ecc68909d6bb15f8cdf295944255a2f9',
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
  if (adapted !== typedPsadtConfig) {
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
  const detectionRules = normalizeCatalogDetectionRules({
    detectionRules: parsedDetectionRules,
    fallbackDetectionRules: rawConfig.detectionRules,
    wingetId: input.wingetId,
    version: input.version,
    installScope: input.installScope || 'machine',
    markerPath: preliminaryConfig.registryMarkerPath,
  });
  const psadtConfig = applyApplicationPackagingAdapter(
    input.wingetId,
    normalizeQaPsadtConfig(rawConfig, detectionRules)
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
    uninstallCommand: input.uninstallCommand,
    installScope: input.installScope || 'machine',
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
    identity,
  };
}

export function buildQaPackageIdentityFromWorkflowInput(
  input: QaWorkflowPackageInput
): QaPackageIdentity {
  return normalizeQaWorkflowPackageInput(input).identity;
}
