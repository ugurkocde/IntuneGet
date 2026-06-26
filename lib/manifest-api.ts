/**
 * Manifest API
 * Primary source: Supabase version_history table (pre-synced from winget-pkgs)
 * Fallback: Direct fetch from GitHub winget-pkgs repository
 */

import YAML from 'yaml';
import { createClient } from '@supabase/supabase-js';
import type {
  WingetManifest,
  WingetInstaller,
  NormalizedInstaller,
  WingetInstallerType,
} from '@/types/winget';
import { getCatalogSource } from '@/lib/catalog';

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests';
const GITHUB_API_BASE = 'https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests';

// Cache for manifest data
const manifestCache = new Map<string, { data: WingetManifest; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Supabase client for server-side operations
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key);
}

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
 * Fetch available versions for a package
 * Priority: Supabase version_history -> GitHub API
 */
export async function fetchAvailableVersions(wingetId: string): Promise<string[]> {
  // Try the catalog first
  try {
    const versions = await getCatalogSource().getVersions(wingetId);
    if (versions.length > 0) {
      return versions;
    }
  } catch (error) {
    console.warn(`Supabase version lookup failed for ${wingetId}:`, error);
  }

  // Fallback to GitHub API
  const { basePath } = getManifestPaths(wingetId);

  try {
    const response = await fetch(`${GITHUB_API_BASE}/${basePath}`, {
      headers: {
        'User-Agent': 'IntuneGet',
        Accept: 'application/vnd.github.v3+json',
      },
      cache: 'no-store', // Avoid stale cache issues in edge runtime
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`Package ${wingetId} not found in GitHub API (404)`);
        return [];
      }
      if (response.status === 403) {
        console.warn(`GitHub API rate limit hit for ${wingetId}`);
        return [];
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const dirs = await response.json();

    const versions = dirs
      .filter((d: { type: string }) => d.type === 'dir')
      .map((d: { name: string }) => d.name)
      .sort((a: string, b: string) =>
        b.localeCompare(a, undefined, { numeric: true })
      );

    console.log(`Found ${versions.length} versions for ${wingetId} from GitHub`);
    return versions;
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
      cache: 'no-store',
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`Installer manifest not found: ${url}`);
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

function localeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasLocaleDescription(manifest: Record<string, unknown> | null): boolean {
  return Boolean(
    manifest &&
      (localeText(manifest.ShortDescription) || localeText(manifest.Description))
  );
}

/**
 * Fetch a single locale manifest file without any fallback resolution
 */
async function fetchLocaleFile(
  wingetId: string,
  version: string,
  locale: string
): Promise<Record<string, unknown> | null> {
  const { basePath } = getManifestPaths(wingetId);
  const url = `${GITHUB_RAW_BASE}/${basePath}/${version}/${wingetId}.locale.${locale}.yaml`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/plain',
        'User-Agent': 'IntuneGet',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    return YAML.parse(await response.text());
  } catch {
    return null;
  }
}

/**
 * Complete locale resolution from already-fetched pieces, mirroring the
 * catalog sync paths: the requested locale wins when it carries a
 * description; singleton manifests keep their locale fields in <id>.yaml;
 * otherwise the package's DefaultLocale file is fetched (e.g. zh-CN-only
 * packages name their only locale file <id>.locale.zh-CN.yaml).
 */
async function resolveLocaleManifest(
  wingetId: string,
  version: string,
  requestedLocale: string,
  requested: Record<string, unknown> | null,
  versionManifest: Record<string, unknown> | null
): Promise<Record<string, unknown> | null> {
  if (hasLocaleDescription(requested)) return requested;
  if (hasLocaleDescription(versionManifest)) return versionManifest;

  const defaultLocale = localeText(versionManifest?.DefaultLocale);
  if (defaultLocale && defaultLocale.toLowerCase() !== requestedLocale.toLowerCase()) {
    const defaultManifest = await fetchLocaleFile(wingetId, version, defaultLocale);
    if (hasLocaleDescription(defaultManifest) || (defaultManifest && !requested)) {
      return defaultManifest;
    }
  }

  return requested;
}

/**
 * Fetch locale manifest (for description, release notes)
 */
export async function fetchLocaleManifest(
  wingetId: string,
  version: string,
  locale: string = 'en-US'
): Promise<Record<string, unknown> | null> {
  const requested = await fetchLocaleFile(wingetId, version, locale);
  if (hasLocaleDescription(requested)) {
    return requested;
  }

  const versionManifest = await fetchVersionManifest(wingetId, version);
  return resolveLocaleManifest(wingetId, version, locale, requested, versionManifest);
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
      cache: 'no-store',
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
 * Try to get manifest from Supabase version_history table first
 */
async function getManifestFromSupabase(
  wingetId: string,
  version?: string
): Promise<WingetManifest | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  try {
    // First get curated app info
    const { data: curatedApp } = await supabase
      .from('curated_apps')
      .select('name, publisher, description, homepage, license, latest_version')
      .eq('winget_id', wingetId)
      .single();

    // Get version history with installer data
    let query = supabase
      .from('version_history')
      .select('*')
      .eq('winget_id', wingetId);

    if (version) {
      query = query.eq('version', version);
    } else {
      query = query.order('created_at', { ascending: false }).limit(1);
    }

    const { data: versionData, error } = await query.single();

    if (error || !versionData) {
      return null;
    }

    // Parse installers from JSONB, recover malformed stringified JSON, or fetch fresh installer manifest
    let installers: WingetInstaller[] = [];

    const parsedInstallers = coerceInstallersArray(versionData.installers, versionData.installer_type);

    if (parsedInstallers.length > 0) {
      installers = parsedInstallers;
    } else {
      // If DB row is incomplete or legacy, fetch authoritative installer manifest for this version.
      const installerManifest = await fetchInstallerManifest(wingetId, versionData.version);
      if (installerManifest) {
        installers = normalizeInstallers(installerManifest);
      }
    }

    if (installers.length === 0 && versionData.installer_url) {
      // Last-resort legacy fallback: preserve row usability even if GitHub fetch fails.
      installers = [{
        Architecture: inferArchitectureFromInstallerUrl(versionData.installer_url),
        InstallerUrl: versionData.installer_url,
        InstallerSha256: versionData.installer_sha256 || '',
        InstallerType: normalizeInstallerType(versionData.installer_type),
        Scope: versionData.installer_scope as WingetInstaller['Scope'],
        InstallerSwitches: versionData.silent_args ? { Silent: versionData.silent_args } : undefined,
      }];
    }

    if (installers.length === 0) {
      return null;
    }

    // Build manifest from cached data
    const manifest: WingetManifest = {
      Id: wingetId,
      Name: curatedApp?.name || wingetId.split('.').slice(1).join(' '),
      Publisher: curatedApp?.publisher || wingetId.split('.')[0],
      Version: versionData.version,
      Description: curatedApp?.description,
      Homepage: curatedApp?.homepage,
      License: curatedApp?.license,
      Installers: installers,
    };

    return manifest;
  } catch (error) {
    console.error(`Failed to get manifest from Supabase for ${wingetId}:`, error);
    return null;
  }
}

function coerceInstallersArray(rawInstallers: unknown, defaultType?: string): WingetInstaller[] {
  let installerArray: Array<Record<string, unknown>> = [];

  if (Array.isArray(rawInstallers)) {
    installerArray = rawInstallers as Array<Record<string, unknown>>;
  } else if (typeof rawInstallers === 'string' && rawInstallers.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(rawInstallers);
      if (Array.isArray(parsed)) {
        installerArray = parsed as Array<Record<string, unknown>>;
      }
    } catch {
      installerArray = [];
    }
  }

  if (installerArray.length === 0) {
    return [];
  }

  return installerArray.map((inst) => ({
    Architecture: (inst.Architecture as WingetInstaller['Architecture']) || 'x64',
    InstallerUrl: (inst.InstallerUrl as string) || '',
    InstallerSha256: (inst.InstallerSha256 as string) || '',
    InstallerType: normalizeInstallerType((inst.InstallerType as string) || defaultType),
    NestedInstallerType: inst.NestedInstallerType as WingetInstaller['NestedInstallerType'],
    NestedInstallerFiles: inst.NestedInstallerFiles as WingetInstaller['NestedInstallerFiles'],
    Scope: inst.Scope as WingetInstaller['Scope'],
    InstallerSwitches: inst.InstallerSwitches as WingetInstaller['InstallerSwitches'],
    ProductCode: inst.ProductCode as string,
    PackageFamilyName: inst.PackageFamilyName as string,
    UpgradeBehavior: inst.UpgradeBehavior as WingetInstaller['UpgradeBehavior'],
    Dependencies: inst.Dependencies as WingetInstaller['Dependencies'],
  }));
}

function inferArchitectureFromInstallerUrl(installerUrl: string): WingetInstaller['Architecture'] {
  const value = installerUrl.toLowerCase();

  if (value.includes('arm64')) return 'arm64';
  if (value.includes('arm')) return 'arm';
  if (value.includes('x86') || value.includes('win32') || value.includes('32-bit')) return 'x86';
  if (value.includes('neutral')) return 'neutral';

  return 'x64';
}

/**
 * Get full manifest with all data combined
 * Priority: Memory cache -> Supabase version_history -> GitHub API
 */
export async function getFullManifest(
  wingetId: string,
  version?: string
): Promise<WingetManifest | null> {
  // Check memory cache
  const cacheKey = `${wingetId}@${version || 'latest'}`;
  const cached = manifestCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    // Try Supabase first (pre-synced data)
    const supabaseManifest = await getManifestFromSupabase(wingetId, version);
    if (supabaseManifest) {
      manifestCache.set(cacheKey, { data: supabaseManifest, timestamp: Date.now() });
      return supabaseManifest;
    }

    // Fallback to GitHub API
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

    // Fetch all manifests in parallel, then finish the locale resolution
    // with the already-fetched version manifest so the common case (en-US
    // locale with a description) costs no extra request
    const [installerManifest, enUSLocale, versionManifest] = await Promise.all([
      fetchInstallerManifest(wingetId, targetVersion),
      fetchLocaleFile(wingetId, targetVersion, 'en-US'),
      fetchVersionManifest(wingetId, targetVersion),
    ]);

    if (!installerManifest) {
      return null;
    }

    const localeManifest = await resolveLocaleManifest(
      wingetId,
      targetVersion,
      'en-US',
      enUSLocale,
      versionManifest
    );

    // Normalize installers
    const installers = normalizeInstallers(installerManifest);

    // Build combined manifest. Description prefers ShortDescription to match
    // what the catalog syncs store in curated_apps, so the same app gets the
    // same text whether it is served from Supabase or this GitHub fallback.
    const manifest: WingetManifest = {
      Id: wingetId,
      Name: (localeManifest?.PackageName as string) || wingetId.split('.').slice(1).join(' '),
      Publisher: (localeManifest?.Publisher as string) || wingetId.split('.')[0],
      Version: targetVersion,
      Description:
        localeText(localeManifest?.ShortDescription) ||
        localeText(localeManifest?.Description) ||
        undefined,
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
  const defaultNestedType = manifest.NestedInstallerType as string;
  const defaultNestedFiles = manifest.NestedInstallerFiles as WingetInstaller['NestedInstallerFiles'];
  const defaultScope = manifest.Scope as string;
  const defaultSwitches = manifest.InstallerSwitches as Record<string, string>;
  const defaultPlatform = manifest.Platform as string[];
  const defaultMinOS = manifest.MinimumOSVersion as string;
  const defaultUpgrade = manifest.UpgradeBehavior as string;
  const defaultDependencies = manifest.Dependencies as WingetInstaller['Dependencies'];

  return rawInstallers.map((installer) => ({
    Architecture: (installer.Architecture as WingetInstaller['Architecture']) || 'x64',
    InstallerUrl: (installer.InstallerUrl as string) || '',
    InstallerSha256: (installer.InstallerSha256 as string) || '',
    InstallerType: normalizeInstallerType(
      (installer.InstallerType as string) || defaultType
    ),
    NestedInstallerType: ((installer.NestedInstallerType as string) || defaultNestedType)
      ? normalizeInstallerType((installer.NestedInstallerType as string) || defaultNestedType)
      : undefined,
    NestedInstallerFiles: (installer.NestedInstallerFiles as WingetInstaller['NestedInstallerFiles']) ||
                          defaultNestedFiles,
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
    Dependencies: (installer.Dependencies as WingetInstaller['Dependencies']) ||
                  defaultDependencies,
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
 * Append manifest Custom switches to the silent switches.
 * winget always appends Custom switches after the silent switches,
 * so manifests that only declare Custom (e.g. Greenshot's '/ALLUSERS')
 * must not lose them during normalization.
 */
function appendCustomSwitch(silentArgs: string, custom: string | undefined): string {
  const customArgs = custom?.trim();

  if (!customArgs) {
    return silentArgs;
  }

  // Dedupe at token level: a plain substring check would treat /S as already
  // present inside /SILENT and silently drop a legitimate custom switch
  const existingTokens = new Set(silentArgs.split(/\s+/).filter(Boolean));
  const newTokens = customArgs.split(/\s+/).filter((token) => token && !existingTokens.has(token));

  if (newTokens.length === 0) {
    return silentArgs;
  }

  return silentArgs ? `${silentArgs} ${newTokens.join(' ')}` : newTokens.join(' ');
}

/**
 * Normalize installer to standard format
 */
export function normalizeInstaller(installer: WingetInstaller): NormalizedInstaller {
  let silentArgs = '';

  // For zip installers the silent switches apply to the nested installer,
  // so derive the default from the nested type (e.g. nested inno gets /VERYSILENT)
  const effectiveType =
    installer.InstallerType === 'zip' && installer.NestedInstallerType
      ? installer.NestedInstallerType
      : installer.InstallerType;

  if (installer.InstallerSwitches?.Silent) {
    silentArgs = installer.InstallerSwitches.Silent;
  } else if (installer.InstallerSwitches?.SilentWithProgress) {
    silentArgs = installer.InstallerSwitches.SilentWithProgress;
  } else {
    silentArgs = getDefaultSilentSwitch(effectiveType);
  }

  silentArgs = appendCustomSwitch(silentArgs, installer.InstallerSwitches?.Custom);

  // Map manifest package dependencies (PascalCase) to the normalized shape
  const rawDependencies = installer.Dependencies?.PackageDependencies;
  const packageDependencies = Array.isArray(rawDependencies)
    ? rawDependencies
        .filter((dep) => typeof dep?.PackageIdentifier === 'string' && dep.PackageIdentifier.length > 0)
        .map((dep) => ({
          packageIdentifier: dep.PackageIdentifier,
          minimumVersion: typeof dep.MinimumVersion === 'string' ? dep.MinimumVersion : undefined,
        }))
    : [];

  return {
    architecture: installer.Architecture,
    url: installer.InstallerUrl,
    sha256: installer.InstallerSha256,
    type: installer.InstallerType,
    nestedInstallerType: installer.NestedInstallerType,
    nestedInstallerPath: installer.NestedInstallerFiles?.[0]?.RelativeFilePath,
    scope: installer.Scope,
    silentArgs,
    productCode: installer.ProductCode,
    packageFamilyName: installer.PackageFamilyName,
    packageDependencies: packageDependencies.length > 0 ? packageDependencies : undefined,
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

/**
 * Fetch similar packages from the same publisher when a package is not found
 * Useful for suggesting correct package IDs when user makes a typo
 */
export async function fetchSimilarPackages(wingetId: string): Promise<string[]> {
  const parts = wingetId.split('.');
  if (parts.length < 2) {
    return [];
  }

  const publisher = parts[0];
  const firstLetter = publisher.charAt(0).toLowerCase();
  const searchName = parts.slice(1).join('').toLowerCase(); // e.g., "CommandConfigure" from "Dell.Command.Configure"

  try {
    // Fetch publisher's folder contents
    const response = await fetch(`${GITHUB_API_BASE}/${firstLetter}/${publisher}`, {
      headers: {
        'User-Agent': 'IntuneGet',
        Accept: 'application/vnd.github.v3+json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return [];
    }

    const contents = await response.json();
    const packages: string[] = [];

    // Recursively build package IDs from folder structure
    async function buildPackageIds(
      items: Array<{ name: string; type: string; url: string }>,
      currentPath: string[]
    ): Promise<void> {
      for (const item of items) {
        if (item.type !== 'dir') continue;

        const newPath = [...currentPath, item.name];
        const potentialId = `${publisher}.${newPath.join('.')}`;

        // Check if this folder contains version folders (has manifest files)
        try {
          const subResponse = await fetch(item.url, {
            headers: {
              'User-Agent': 'IntuneGet',
              Accept: 'application/vnd.github.v3+json',
            },
          });

          if (subResponse.ok) {
            const subContents = await subResponse.json();
            const hasVersionFolders = subContents.some(
              (sub: { name: string; type: string }) =>
                sub.type === 'dir' && /^\d/.test(sub.name)
            );

            if (hasVersionFolders) {
              packages.push(potentialId);
            } else {
              // Go deeper
              await buildPackageIds(subContents, newPath);
            }
          }
        } catch {
          // Skip on error
        }
      }
    }

    await buildPackageIds(contents, []);

    // Score and sort by similarity to the searched name
    const scored = packages.map((pkg) => {
      const pkgName = pkg.split('.').slice(1).join('').toLowerCase();
      let score = 0;

      // Exact substring match
      if (pkgName.includes(searchName) || searchName.includes(pkgName)) {
        score += 100;
      }

      // Character overlap
      const searchChars = new Set(searchName);
      const pkgChars = new Set(pkgName);
      const overlap = [...searchChars].filter((c) => pkgChars.has(c)).length;
      score += overlap * 10;

      // Length similarity
      const lenDiff = Math.abs(pkgName.length - searchName.length);
      score -= lenDiff * 2;

      return { pkg, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => s.pkg);
  } catch (error) {
    console.error(`Failed to fetch similar packages for ${wingetId}:`, error);
    return [];
  }
}
