import { generateDetectionRules, generateUninstallCommand } from '@/lib/detection-rules';
import { normalizeInstaller } from '@/lib/manifest-api';
import type { DetectionRule } from '@/types/intune';
import { DEFAULT_PSADT_CONFIG, type PSADTConfig } from '@/types/psadt';
import {
  applyApplicationPackagingAdapter,
  resolveApplicationInstallScope,
} from '@/lib/packaging-adapters';
import { normalizeQaPsadtConfig } from './package-profile';
import type {
  WingetInstaller,
  WingetInstallerSwitches,
  WingetInstallerType,
  WingetScope,
} from '@/types/winget';
import type { WingetInstallerCandidate } from './candidate';
import type { PackagedWingetDependency } from '@/lib/winget-dependencies';

export interface QaCatalogTestConfig {
  mode: 'psadt-package';
  displayName: string;
  publisher: string;
  sourceInstallerType: string;
  silentArgs: string;
  successCodes: number[];
  productCode: string;
  scope: string;
  nestedInstallerType: string;
  nestedInstallerFiles: string[];
  uninstallCommand: string;
  psadtConfig: PSADTConfig;
  detectionRules: DetectionRule[];
  packageDependencies?: PackagedWingetDependency[];
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
    const productCode = msiProductCode(record(entry).ProductCode);
    if (productCode) return productCode;
  }
  return '';
}

function msiProductCode(value: unknown): string {
  const candidate = text(value);
  const match = candidate.match(
    /^\{?([A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})\}?$/
  );
  return match ? `{${match[1].toUpperCase()}}` : '';
}

export function buildQaCatalogTestConfig({
  app,
  manifest,
  installer,
  packageDependencies = [],
}: {
  app: { wingetId: string; name: string; publisher: string; version: string };
  manifest: ManifestRecord;
  installer: WingetInstallerCandidate & ManifestRecord;
  packageDependencies?: PackagedWingetDependency[];
}): QaCatalogTestConfig {
  // WinGet installer defaults are inherited per switch field, not as one
  // replaceable object. Preserve root Silent when a selected installer only
  // overrides Custom, Log, or another field.
  const effectiveSwitches = {
    ...record(manifest.InstallerSwitches),
    ...record(installer.InstallerSwitches),
  };
  const effectiveNestedFiles = Array.isArray(installer.NestedInstallerFiles)
    ? installer.NestedInstallerFiles
    : Array.isArray(manifest.NestedInstallerFiles)
      ? manifest.NestedInstallerFiles
      : [];
  const nestedFiles = effectiveNestedFiles
    .map((entry) => text(record(entry).RelativeFilePath))
    .filter(Boolean)
    .slice(0, 20);
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
  const rawNestedInstallerType =
    text(installer.NestedInstallerType) || text(manifest.NestedInstallerType);
  const nestedInstallerType = supportedTypes.has(
    rawNestedInstallerType.toLowerCase() as WingetInstallerType
  )
    ? (rawNestedInstallerType.toLowerCase() as WingetInstallerType)
    : undefined;
  const rawScope = text(installer.Scope) || text(manifest.Scope);
  const scope: WingetScope = resolveApplicationInstallScope(app.wingetId, rawScope);
  const explicitInstallerProductCode = text(installer.ProductCode);
  const productCode = explicitInstallerProductCode
    ? msiProductCode(explicitInstallerProductCode)
    : appsAndFeaturesProductCode(installer) ||
      msiProductCode(manifest.ProductCode) ||
      appsAndFeaturesProductCode(manifest);
  const packageFamilyName =
    text(installer.PackageFamilyName) || text(manifest.PackageFamilyName);
  const inheritedInstaller: WingetInstaller = {
    Architecture: (text(installer.Architecture).toLowerCase() ||
      'x64') as WingetInstaller['Architecture'],
    InstallerUrl: text(installer.InstallerUrl),
    InstallerSha256: text(installer.InstallerSha256),
    InstallerType: sourceInstallerType,
    NestedInstallerType: nestedInstallerType,
    NestedInstallerFiles: nestedFiles.map((relativeFilePath) => ({
      RelativeFilePath: relativeFilePath,
    })),
    Scope: scope,
    InstallerSwitches: normalizeInstallerSwitches(effectiveSwitches),
    InstallerSuccessCodes: normalizeSuccessCodes(
      installer.InstallerSuccessCodes ?? manifest.InstallerSuccessCodes
    ),
    ProductCode: productCode || undefined,
    PackageFamilyName: packageFamilyName || undefined,
  };
  const normalizedInstaller = normalizeInstaller(inheritedInstaller);
  const detectionRules = generateDetectionRules(
    normalizedInstaller,
    app.name,
    app.wingetId,
    app.version,
    DEFAULT_PSADT_CONFIG.registryMarkerPath
  );
  const psadtConfig: PSADTConfig = applyApplicationPackagingAdapter(
    app.wingetId,
    normalizeQaPsadtConfig(
      {
        ...DEFAULT_PSADT_CONFIG,
        deployMode: 'Auto',
        progressDialog: {
          ...DEFAULT_PSADT_CONFIG.progressDialog,
          enabled: true,
          statusMessage: 'IntuneGet is validating this application package.',
          windowLocation: 'BottomRight',
        },
      },
      detectionRules
    )
  );

  return {
    mode: 'psadt-package',
    displayName: app.name,
    publisher: app.publisher,
    sourceInstallerType,
    silentArgs: normalizedInstaller.silentArgs || '',
    successCodes: normalizedInstaller.installerSuccessCodes || [],
    productCode,
    scope,
    nestedInstallerType: nestedInstallerType || '',
    nestedInstallerFiles: nestedFiles,
    uninstallCommand: generateUninstallCommand(normalizedInstaller, app.name),
    psadtConfig,
    detectionRules,
    ...(packageDependencies.length > 0 ? { packageDependencies } : {}),
    profileKind: 'catalog-default',
  };
}

function normalizeSuccessCodes(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const codes = Array.from(new Set(value
    .map((code) => typeof code === 'number' ? code : Number(code))
    .filter((code) => Number.isInteger(code) && code >= 0 && code <= 65535)));
  return codes.length > 0 ? codes : undefined;
}

function isRecord(value: unknown): value is ManifestRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeInstallerSwitches(value: unknown): WingetInstallerSwitches | undefined {
  if (!isRecord(value)) return undefined;

  const switches: WingetInstallerSwitches = {};
  const keys: Array<keyof WingetInstallerSwitches> = [
    'Silent',
    'SilentWithProgress',
    'Interactive',
    'InstallLocation',
    'Log',
    'Upgrade',
    'Custom',
  ];
  for (const key of keys) {
    const normalized = text(value[key]);
    if (normalized) switches[key] = normalized;
  }
  return switches;
}
