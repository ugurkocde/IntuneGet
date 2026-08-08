import { createHash } from 'node:crypto';
import type { DetectionRule } from '@/types/intune';
import { DEFAULT_PSADT_CONFIG, type PSADTConfig } from '@/types/psadt';

export const QA_PSADT_TOOLCHAIN = {
  packagerRepository: 'ugurkocde/IntuneGet',
  packagerCommit: '70685a9a689b7cdeb4edba8ec5eadd1cc8bb2cc5',
  packagerScriptPath: '.github/scripts/Create-PSADTPackage.ps1',
  psadtVersion: '4.1.8',
  templateUrl:
    'https://github.com/PSAppDeployToolkit/PSAppDeployToolkit/releases/download/4.1.8/PSAppDeployToolkit_Template_v4.zip',
  templateSha256: '50CB8D32973FC7648060A48CAD63912ECB5CACA5A70754F37E83AA06BD380283',
} as const;

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
  nestedInstallerFiles: string[];
  psadtConfig: PSADTConfig;
  detectionRules: DetectionRule[];
}

export interface QaPackageIdentity {
  profile: Record<string, unknown>;
  canonicalJson: string;
  packageProfileSha256: string;
  psadtConfigSha256: string;
  detectionRulesSha256: string;
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
  const psadtConfigSha256 = qaSha256(canonicalQaJson(input.psadtConfig));
  const detectionRulesSha256 = qaSha256(canonicalQaJson(input.detectionRules));
  const profile = {
    schemaVersion: 1,
    testLevel: 'psadt-package',
    profileKind: input.profileKind,
    toolchain: QA_PSADT_TOOLCHAIN,
    app: {
      wingetId: input.wingetId,
      displayName: input.displayName,
      publisher: input.publisher,
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
    psadtConfig: input.psadtConfig,
    detectionRules: input.detectionRules,
    psadtConfigSha256,
    detectionRulesSha256,
  };
  const canonicalJson = canonicalQaJson(profile);
  return {
    profile,
    canonicalJson,
    packageProfileSha256: qaSha256(canonicalJson),
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
