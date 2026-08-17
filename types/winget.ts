/**
 * Winget API Types
 * Based on winget.run REST API responses
 */

// Package search result from winget.run
export interface WingetSearchResult {
  Id: string;
  Name: string;
  Publisher: string;
  Version: string;
  Description?: string;
}

// Full package details
export interface WingetPackage {
  Id: string;
  Name: string;
  Publisher: string;
  Version: string;
  Description?: string;
  Homepage?: string;
  License?: string;
  LicenseUrl?: string;
  Tags?: string[];
  Moniker?: string;
  Versions?: string[];
}

// Installer information from manifest
export interface WingetInstaller {
  Architecture: WingetArchitecture;
  InstallerUrl: string;
  InstallerSha256: string;
  InstallerType: WingetInstallerType;
  NestedInstallerType?: WingetInstallerType;
  NestedInstallerFiles?: Array<{ RelativeFilePath: string; PortableCommandAlias?: string }>;
  Scope?: WingetScope;
  ElevationRequirement?: WingetElevationRequirement;
  InstallerSwitches?: WingetInstallerSwitches;
  InstallLocationRequired?: boolean;
  DefaultInstallLocation?: string;
  InstallerSuccessCodes?: number[];
  ProductCode?: string;
  PackageFamilyName?: string;
  UpgradeBehavior?: 'install' | 'uninstallPrevious';
  InstallerLocale?: string;
  Platform?: string[];
  MinimumOSVersion?: string;
  Dependencies?: WingetDependencies;
}

// Installer switches for silent installation
export interface WingetInstallerSwitches {
  Silent?: string;
  SilentWithProgress?: string;
  Interactive?: string;
  InstallLocation?: string;
  Log?: string;
  Upgrade?: string;
  Custom?: string;
}

// Dependencies
export interface WingetDependencies {
  WindowsFeatures?: string[];
  WindowsLibraries?: string[];
  PackageDependencies?: WingetPackageDependency[];
  ExternalDependencies?: string[];
}

export interface WingetPackageDependency {
  PackageIdentifier: string;
  MinimumVersion?: string;
}

// Full manifest including all installers
export interface WingetManifest {
  Id: string;
  Name: string;
  Publisher: string;
  Version: string;
  Description?: string;
  Homepage?: string;
  License?: string;
  LicenseUrl?: string;
  ShortDescription?: string;
  Moniker?: string;
  Tags?: string[];
  Installers: WingetInstaller[];
  DefaultLocale?: string;
  ManifestType?: string;
  ManifestVersion?: string;
}

// Supported architectures
export type WingetArchitecture = 'x64' | 'x86' | 'arm64' | 'arm' | 'neutral';

// Supported installer types
export type WingetInstallerType =
  | 'msix'
  | 'msi'
  | 'appx'
  | 'exe'
  | 'zip'
  | 'inno'
  | 'nullsoft'
  | 'wix'
  | 'burn'
  | 'pwa'
  | 'portable';

// Installation scope
export type WingetScope = 'user' | 'machine';

// Installer privilege behavior declared by WinGet manifests.
export type WingetElevationRequirement =
  | 'elevationRequired'
  | 'elevationProhibited'
  | 'elevatesSelf';

// API response wrapper for search
export interface WingetSearchResponse {
  Packages: WingetSearchResult[];
  Total: number;
}

// API response for package versions
export interface WingetVersionsResponse {
  Id: string;
  Versions: string[];
}

// Locale variant metadata for language-specific packages
export interface LocaleVariant {
  wingetId: string;       // e.g., "Mozilla.Firefox.de"
  localeCode: string;     // e.g., "de"
  localeName: string;     // e.g., "Deutsch"
  countryFlag: string;    // ISO 3166-1 alpha-2 country code, e.g., "DE"
  flagEmoji?: string;     // Pre-rendered flag emoji, e.g., flag for DE
  version?: string;
}

// App source type
export type AppSource = 'win32' | 'store';

// Normalized package data for internal use
export interface NormalizedPackage {
  id: string;
  name: string;
  publisher: string;
  version: string;
  description?: string;
  homepage?: string;
  license?: string;
  tags?: string[];
  versions?: string[];
  // Curated app fields
  iconPath?: string;
  category?: string;
  popularityRank?: number;
  installerType?: string;
  // App source (win32 = winget LOB, store = Microsoft Store)
  appSource?: AppSource;
  // Microsoft Store product ID (e.g. "9WZDNCRFJ3PZ")
  packageIdentifier?: string;
  // Locale variant fields
  localeVariants?: LocaleVariant[];
  isLocaleVariant?: boolean;
  parentWingetId?: string;
  localeCode?: string;
}

// Normalized installer for internal use
export interface NormalizedInstaller {
  architecture: WingetArchitecture;
  installerLocale?: string;
  url: string;
  sha256: string;
  type: WingetInstallerType;
  nestedInstallerType?: WingetInstallerType;
  nestedInstallerPath?: string;
  scope?: WingetScope;
  elevationRequirement?: WingetElevationRequirement;
  silentArgs?: string;
  installLocationRequired?: boolean;
  defaultInstallLocation?: string;
  installerSuccessCodes?: number[];
  productCode?: string;
  packageFamilyName?: string;
  packageDependencies?: Array<{ packageIdentifier: string; minimumVersion?: string }>;
  windowsFeatures?: string[];
  windowsLibraries?: string[];
  externalDependencies?: string[];
}

// Microsoft Store manifest enrichment (fetched from public Store APIs)
export interface StoreManifestResponse {
  packageIdentifier: string;
  packageName: string;
  publisher: string;
  description: string;
  shortDescription: string;
  packageFamilyName?: string;
  architectures: string[];
  iconUrl?: string;
}
