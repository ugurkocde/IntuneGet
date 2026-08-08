import { generateDetectionRules, generateUninstallCommand } from '@/lib/detection-rules';
import type { DetectionRule } from '@/types/intune';
import { DEFAULT_PSADT_CONFIG, type PSADTConfig } from '@/types/psadt';
import { normalizeQaPsadtConfig } from './package-profile';
import type { NormalizedInstaller, WingetInstallerType, WingetScope } from '@/types/winget';
import type { WingetInstallerCandidate } from './candidate';

export interface QaCatalogTestConfig {
  mode: 'psadt-package';
  displayName: string;
  publisher: string;
  sourceInstallerType: string;
  silentArgs: string;
  productCode: string;
  scope: string;
  nestedInstallerType: string;
  nestedInstallerFiles: string[];
  uninstallCommand: string;
  psadtConfig: PSADTConfig;
  detectionRules: DetectionRule[];
  profileKind: 'catalog-default';
  packageProfileCanonicalJson?: string;
  packageProfileSha256?: string;
  psadtConfigSha256?: string;
  detectionRulesSha256?: string;
}

type ManifestRecord = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): ManifestRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ManifestRecord)
    : {};
}

function appsAndFeaturesProductCode(installer: ManifestRecord): string {
  const entries = Array.isArray(installer.AppsAndFeaturesEntries)
    ? installer.AppsAndFeaturesEntries
    : [];
  for (const entry of entries) {
    const productCode = text(record(entry).ProductCode);
    if (productCode) return productCode;
  }
  return '';
}

function msiProductCode(value: unknown): string {
  const candidate = text(value);
  return /^\{?[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}?$/.test(
    candidate
  )
    ? candidate
    : '';
}

export function buildQaCatalogTestConfig({
  app,
  manifest,
  installer,
}: {
  app: { wingetId: string; name: string; publisher: string; version: string };
  manifest: ManifestRecord;
  installer: WingetInstallerCandidate & ManifestRecord;
}): QaCatalogTestConfig {
  const rootSwitches = record(manifest.InstallerSwitches);
  const installerSwitches = record(installer.InstallerSwitches);
  const silentArgs =
    text(installerSwitches.Silent) ||
    text(installerSwitches.SilentWithProgress) ||
    text(rootSwitches.Silent) ||
    text(rootSwitches.SilentWithProgress);
  const nestedFiles = Array.isArray(installer.NestedInstallerFiles)
    ? installer.NestedInstallerFiles
        .map((entry) => text(record(entry).RelativeFilePath))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const rawSourceType =
    text(installer.InstallerType) || text(manifest.InstallerType) || 'exe';
  const supportedTypes = new Set<WingetInstallerType>([
    'msix',
    'msi',
    'appx',
    'exe',
    'zip',
    'inno',
    'nullsoft',
    'wix',
    'burn',
    'pwa',
    'portable',
  ]);
  const sourceInstallerType = supportedTypes.has(rawSourceType.toLowerCase() as WingetInstallerType)
    ? (rawSourceType.toLowerCase() as WingetInstallerType)
    : 'exe';
  const rawScope = text(installer.Scope) || text(manifest.Scope);
  const scope: WingetScope = rawScope.toLowerCase() === 'user' ? 'user' : 'machine';
  const productCode =
    msiProductCode(installer.ProductCode) ||
    msiProductCode(appsAndFeaturesProductCode(installer));
  const normalizedInstaller: NormalizedInstaller = {
    architecture: (text(installer.Architecture).toLowerCase() || 'x64') as NormalizedInstaller['architecture'],
    url: text(installer.InstallerUrl),
    sha256: text(installer.InstallerSha256),
    type: sourceInstallerType,
    nestedInstallerType: text(installer.NestedInstallerType).toLowerCase() as WingetInstallerType,
    nestedInstallerPath: nestedFiles[0],
    scope,
    silentArgs,
    productCode: productCode || undefined,
    packageFamilyName: text(installer.PackageFamilyName) || undefined,
  };
  const detectionRules = generateDetectionRules(
    normalizedInstaller,
    app.name,
    app.wingetId,
    app.version,
    DEFAULT_PSADT_CONFIG.registryMarkerPath
  );
  const psadtConfig: PSADTConfig = normalizeQaPsadtConfig(DEFAULT_PSADT_CONFIG, detectionRules);

  return {
    mode: 'psadt-package',
    displayName: app.name,
    publisher: app.publisher,
    sourceInstallerType,
    silentArgs,
    productCode,
    scope,
    nestedInstallerType:
      text(installer.NestedInstallerType) || text(manifest.NestedInstallerType),
    nestedInstallerFiles: nestedFiles,
    uninstallCommand: generateUninstallCommand(normalizedInstaller, app.name),
    psadtConfig,
    detectionRules,
    profileKind: 'catalog-default',
  };
}
