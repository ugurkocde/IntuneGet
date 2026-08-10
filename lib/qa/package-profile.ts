import { createHash } from 'node:crypto';
import type { DetectionRule } from '@/types/intune';
import { DEFAULT_PSADT_CONFIG, type PSADTConfig } from '@/types/psadt';

export const QA_PSADT_TOOLCHAIN = {
  packagerRepository: 'ugurkocde/IntuneGet',
  packagerCommit: '90b9a62446621395f7da57504273221c71210341',
  packagerScriptPath: '.github/scripts/Create-PSADTPackage.ps1',
  psadtVersion: '4.1.8',
  templateUrl:
    'https://github.com/PSAppDeployToolkit/PSAppDeployToolkit/releases/download/4.1.8/PSAppDeployToolkit_Template_v4.zip',
  templateSha256: '50CB8D32973FC7648060A48CAD63912ECB5CACA5A70754F37E83AA06BD380283',
} as const;

/**
 * Increment this whenever profile-building semantics change without a corresponding
 * toolchain-pin change (for example, default PSADT settings or detection derivation),
 * and update the protected workflow verifier in the same rollout. Existing candidates
 * then fail closed and are rebuilt before they can be dispatched.
 */
export const QA_PACKAGE_PROFILE_SCHEMA_VERSION = 2;

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
  uninstallCommand: string;
  installScope: string;
  nestedInstallerType: string;
  nestedInstallerFiles: readonly string[];
  psadtConfig: PSADTConfig;
  detectionRules: DetectionRule[];
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
  uninstallCommand: string;
  installScope?: string;
  psadtConfig?: string;
  detectionRules?: string;
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
export function validateCurrentQaPackageProfile(input: {
  testConfig: unknown;
  candidatePackageProfileSha256: unknown;
  candidateWingetId: unknown;
  candidateVersion: unknown;
  candidateArchitecture: unknown;
  candidateInstallerSha256: unknown;
}): QaPackageProfileValidation {
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

  return {
    valid: true,
    canonicalJson,
    packageProfileSha256: calculatedSha256,
  };
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
      uninstallCommand: input.uninstallCommand,
      installScope: input.installScope || 'machine',
      nestedInstallerType: input.nestedInstallerType.toLowerCase(),
      nestedInstallerFiles: input.nestedInstallerFiles,
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

export function buildQaPackageIdentityFromWorkflowInput(
  input: QaWorkflowPackageInput
): QaPackageIdentity {
  const detectionRules = parseJsonObject<DetectionRule[]>(input.detectionRules, []);
  const rawConfig = parseJsonObject<Partial<PSADTConfig>>(input.psadtConfig, {});
  const psadtConfig = normalizeQaPsadtConfig(rawConfig, detectionRules);
  return buildQaPackageIdentity({
    profileKind: 'deployment-config',
    wingetId: input.wingetId,
    displayName: input.displayName,
    publisher: input.publisher,
    version: input.version,
    architecture: input.architecture || 'x64',
    installerSha256: input.installerSha256,
    sourceInstallerType: input.installerType,
    silentArgs: input.silentSwitches,
    uninstallCommand: input.uninstallCommand,
    installScope: input.installScope || 'machine',
    nestedInstallerType: input.nestedInstallerType || '',
    nestedInstallerFiles: input.nestedInstallerPath ? [input.nestedInstallerPath] : [],
    psadtConfig,
    detectionRules,
  });
}
