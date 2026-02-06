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
  Scope?: WingetScope;
  InstallerSwitches?: WingetInstallerSwitches;
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
}

// Normalized installer for internal use
export interface NormalizedInstaller {
  architecture: WingetArchitecture;
  url: string;
  sha256: string;
  type: WingetInstallerType;
  scope?: WingetScope;
  silentArgs?: string;
  productCode?: string;
  packageFamilyName?: string;
}
