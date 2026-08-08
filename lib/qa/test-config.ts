import type { WingetInstallerCandidate } from './candidate';

export interface QaCatalogTestConfig {
  [key: string]: string | string[];
  mode: 'catalog';
  displayName: string;
  publisher: string;
  sourceInstallerType: string;
  silentArgs: string;
  productCode: string;
  scope: string;
  nestedInstallerType: string;
  nestedInstallerFiles: string[];
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
  app: { name: string; publisher: string };
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

  return {
    mode: 'catalog',
    displayName: app.name,
    publisher: app.publisher,
    sourceInstallerType:
      text(installer.InstallerType) || text(manifest.InstallerType) || 'exe',
    silentArgs,
    productCode:
      msiProductCode(installer.ProductCode) ||
      msiProductCode(appsAndFeaturesProductCode(installer)),
    scope: text(installer.Scope) || text(manifest.Scope),
    nestedInstallerType:
      text(installer.NestedInstallerType) || text(manifest.NestedInstallerType),
    nestedInstallerFiles: nestedFiles,
  };
}
