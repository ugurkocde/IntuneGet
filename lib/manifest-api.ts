/**
 * Manifest API
 * Direct fetch from GitHub winget-pkgs repository
 * Replaces WinGet.Run API dependency
 */

import YAML from 'yaml';
import type {
  WingetManifest,
  WingetInstaller,
  NormalizedInstaller,
  WingetInstallerType,
} from '@/types/winget';

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests';
const GITHUB_API_BASE = 'https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests';

// Cache for manifest data
const manifestCache = new Map<string, { data: WingetManifest; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Build paths for Winget manifest URLs
 * Each segment of the package ID becomes a directory in the path
 * e.g., "Adobe.Acrobat.Reader.64-bit" -> "a/Adobe/Acrobat/Reader/64-bit"
 */
function getManifestPaths(wingetId: string) {
  const parts = wingetId.split('.');
  if (parts.length < 2) {
    throw new Error(`Invalid Winget ID format: ${wingetId}`);
  }

  const publisher = parts[0];
  const firstLetter = publisher.charAt(0).toLowerCase();
  // Join all parts with '/' to create the full directory path
  const basePath = `${firstLetter}/${parts.join('/')}`;

  return {
    publisher,
    name: parts.slice(1).join('.'),
    firstLetter,
    basePath,
  };
}

/**
 * Fetch available versions for a package from GitHub API
 */
export async function fetchAvailableVersions(wingetId: string): Promise<string[]> {
  const { basePath } = getManifestPaths(wingetId);

  try {
    const response = await fetch(`${GITHUB_API_BASE}/${basePath}`, {
      headers: {
        'User-Agent': 'IntuneGet',
        Accept: 'application/vnd.github.v3+json',
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const dirs = await response.json();

    return dirs
      .filter((d: { type: string }) => d.type === 'dir')
      .map((d: { name: string }) => d.name)
      .sort((a: string, b: string) =>
        b.localeCompare(a, undefined, { numeric: true })
      );
  } catch (error) {
    console.error(`Failed to fetch versions for ${wingetId}:`, error);
    return [];
  }
}

/**
 * Fetch installer manifest from GitHub
 */
export async function fetchInstallerManifest(
  wingetId: string,
  version: string
): Promise<Record<string, unknown> | null> {
  const { basePath } = getManifestPaths(wingetId);
  const url = `${GITHUB_RAW_BASE}/${basePath}/${version}/${wingetId}.installer.yaml`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/plain',
        'User-Agent': 'IntuneGet',
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`GitHub fetch error: ${response.status}`);
    }

    const yamlContent = await response.text();
    return YAML.parse(yamlContent);
  } catch (error) {
    console.error(`Failed to fetch installer manifest for ${wingetId}@${version}:`, error);
    return null;
  }
}

/**
 * Fetch locale manifest (for description, release notes)
 */
export async function fetchLocaleManifest(
  wingetId: string,
  version: string,
  locale: string = 'en-US'
): Promise<Record<string, unknown> | null> {
  const { basePath } = getManifestPaths(wingetId);

  // Try specific locale first, then default
  const locales = [`locale.${locale}`, 'locale'];

  for (const localeFile of locales) {
    const url = `${GITHUB_RAW_BASE}/${basePath}/${version}/${wingetId}.${localeFile}.yaml`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/plain',
          'User-Agent': 'IntuneGet',
        },
        next: { revalidate: 300 },
      });

      if (response.ok) {
        const yamlContent = await response.text();
        return YAML.parse(yamlContent);
      }
    } catch {
      // Continue to next locale
    }
  }

  return null;
}

/**
 * Fetch version manifest (basic package info)
 */
export async function fetchVersionManifest(
  wingetId: string,
  version: string
): Promise<Record<string, unknown> | null> {
  const { basePath } = getManifestPaths(wingetId);
  const url = `${GITHUB_RAW_BASE}/${basePath}/${version}/${wingetId}.yaml`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/plain',
        'User-Agent': 'IntuneGet',
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return null;
    }

    const yamlContent = await response.text();
    return YAML.parse(yamlContent);
  } catch {
    return null;
  }
}

/**
 * Get full manifest with all data combined
 */
export async function getFullManifest(
  wingetId: string,
  version?: string
): Promise<WingetManifest | null> {
  // Check cache
  const cacheKey = `${wingetId}@${version || 'latest'}`;
  const cached = manifestCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    // Get version if not specified
    let targetVersion = version;
    if (!targetVersion) {
      const versions = await fetchAvailableVersions(wingetId);
      if (versions.length === 0) {
        console.warn(`Package ${wingetId} has no available versions in winget-pkgs`);
        return null;
      }
      targetVersion = versions[0];
    }

    // Fetch all manifests in parallel
    const [installerManifest, localeManifest, versionManifest] = await Promise.all([
      fetchInstallerManifest(wingetId, targetVersion),
      fetchLocaleManifest(wingetId, targetVersion),
      fetchVersionManifest(wingetId, targetVersion),
    ]);

    if (!installerManifest) {
      return null;
    }

    // Normalize installers
    const installers = normalizeInstallers(installerManifest);

    // Build combined manifest
    const manifest: WingetManifest = {
      Id: wingetId,
      Name: (localeManifest?.PackageName as string) || wingetId.split('.').slice(1).join(' '),
      Publisher: (localeManifest?.Publisher as string) || wingetId.split('.')[0],
      Version: targetVersion,
      Description: (localeManifest?.Description as string) || (localeManifest?.ShortDescription as string),
      Homepage: (localeManifest?.PackageUrl as string) || (localeManifest?.PublisherUrl as string),
      License: localeManifest?.License as string,
      LicenseUrl: localeManifest?.LicenseUrl as string,
      ShortDescription: localeManifest?.ShortDescription as string,
      Moniker: versionManifest?.Moniker as string,
      Tags: localeManifest?.Tags as string[],
      Installers: installers,
      DefaultLocale: versionManifest?.DefaultLocale as string,
      ManifestType: installerManifest.ManifestType as string,
      ManifestVersion: installerManifest.ManifestVersion as string,
    };

    // Cache the result
    manifestCache.set(cacheKey, { data: manifest, timestamp: Date.now() });

    return manifest;
  } catch (error) {
    console.error(`Failed to get full manifest for ${wingetId}:`, error);
    return null;
  }
}

/**
 * Normalize installers from raw YAML
 */
function normalizeInstallers(manifest: Record<string, unknown>): WingetInstaller[] {
  const rawInstallers = (manifest.Installers as Array<Record<string, unknown>>) || [];

  // Get top-level defaults
  const defaultType = manifest.InstallerType as string;
  const defaultScope = manifest.Scope as string;
  const defaultSwitches = manifest.InstallerSwitches as Record<string, string>;
  const defaultPlatform = manifest.Platform as string[];
  const defaultMinOS = manifest.MinimumOSVersion as string;
  const defaultUpgrade = manifest.UpgradeBehavior as string;

  return rawInstallers.map((installer) => ({
    Architecture: (installer.Architecture as WingetInstaller['Architecture']) || 'x64',
    InstallerUrl: (installer.InstallerUrl as string) || '',
    InstallerSha256: (installer.InstallerSha256 as string) || '',
    InstallerType: normalizeInstallerType(
      (installer.InstallerType as string) || defaultType
    ),
    Scope: (installer.Scope as WingetInstaller['Scope']) ||
           (defaultScope as WingetInstaller['Scope']),
    InstallerSwitches: (installer.InstallerSwitches as WingetInstaller['InstallerSwitches']) ||
                       defaultSwitches,
    ProductCode: installer.ProductCode as string,
    PackageFamilyName: installer.PackageFamilyName as string,
    UpgradeBehavior: (installer.UpgradeBehavior as WingetInstaller['UpgradeBehavior']) ||
                     (defaultUpgrade as WingetInstaller['UpgradeBehavior']),
    InstallerLocale: installer.InstallerLocale as string,
    Platform: (installer.Platform as string[]) || defaultPlatform,
    MinimumOSVersion: (installer.MinimumOSVersion as string) || defaultMinOS,
  }));
}

/**
 * Normalize installer type string
 */
function normalizeInstallerType(type: string | undefined): WingetInstallerType {
  if (!type) return 'exe';

  const typeMap: Record<string, WingetInstallerType> = {
    msix: 'msix',
    msi: 'msi',
    appx: 'appx',
    exe: 'exe',
    zip: 'zip',
    inno: 'inno',
    nullsoft: 'nullsoft',
    wix: 'wix',
    burn: 'burn',
    pwa: 'pwa',
    portable: 'portable',
  };

  return typeMap[type.toLowerCase()] || 'exe';
}

/**
 * Get default silent switch based on installer type
 */
function getDefaultSilentSwitch(installerType: WingetInstallerType): string {
  const defaults: Record<WingetInstallerType, string> = {
    msi: '/qn /norestart',
    msix: '',
    appx: '',
    exe: '/S',
    inno: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
    nullsoft: '/S',
    wix: '/qn /norestart',
    burn: '/quiet /norestart',
    zip: '',
    pwa: '',
    portable: '',
  };

  return defaults[installerType] || '';
}

/**
 * Normalize installer to standard format
 */
export function normalizeInstaller(installer: WingetInstaller): NormalizedInstaller {
  let silentArgs = '';

  if (installer.InstallerSwitches?.Silent) {
    silentArgs = installer.InstallerSwitches.Silent;
  } else if (installer.InstallerSwitches?.SilentWithProgress) {
    silentArgs = installer.InstallerSwitches.SilentWithProgress;
  } else {
    silentArgs = getDefaultSilentSwitch(installer.InstallerType);
  }

  return {
    architecture: installer.Architecture,
    url: installer.InstallerUrl,
    sha256: installer.InstallerSha256,
    type: installer.InstallerType,
    scope: installer.Scope,
    silentArgs,
    productCode: installer.ProductCode,
    packageFamilyName: installer.PackageFamilyName,
  };
}

/**
 * Get installers for a package
 */
export async function getInstallers(
  wingetId: string,
  version?: string
): Promise<NormalizedInstaller[]> {
  const manifest = await getFullManifest(wingetId, version);
  if (!manifest?.Installers) {
    return [];
  }

  return manifest.Installers.map(normalizeInstaller);
}

/**
 * Get the best installer for a given architecture
 */
export async function getBestInstaller(
  wingetId: string,
  version?: string,
  preferredArch: 'x64' | 'x86' | 'arm64' = 'x64'
): Promise<NormalizedInstaller | null> {
  const installers = await getInstallers(wingetId, version);

  if (installers.length === 0) {
    return null;
  }

  const archPriority: Record<string, string[]> = {
    x64: ['x64', 'neutral', 'x86'],
    x86: ['x86', 'neutral', 'x64'],
    arm64: ['arm64', 'arm', 'neutral', 'x64'],
  };

  const priority = archPriority[preferredArch] || archPriority.x64;

  for (const arch of priority) {
    const installer = installers.find((i) => i.architecture === arch);
    if (installer) {
      return installer;
    }
  }

  return installers[0];
}

/**
 * Clear manifest cache
 */
export function clearManifestCache(): void {
  manifestCache.clear();
}

/**
 * Check if a package exists in Winget
 */
export async function packageExists(wingetId: string): Promise<boolean> {
  const versions = await fetchAvailableVersions(wingetId);
  return versions.length > 0;
}
