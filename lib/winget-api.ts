/**
 * Winget API Client
 * Uses curated app catalog with Supabase for search/discovery
 * Uses GitHub raw manifests for installer data via manifest-api.ts
 */

import { createClient } from '@supabase/supabase-js';
import type {
  WingetManifest,
  WingetInstaller,
  NormalizedPackage,
  NormalizedInstaller,
  WingetInstallerType,
} from '@/types/winget';
import {
  getFullManifest,
  getInstallers as getManifestInstallers,
  getBestInstaller as getManifestBestInstaller,
  fetchAvailableVersions,
} from './manifest-api';

// Supabase client for server-side operations
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase configuration missing');
  }

  return createClient(url, key);
}

/**
 * Extended package type with curated app fields
 */
export interface CuratedPackage extends NormalizedPackage {
  iconPath?: string;
  category?: string;
  popularityRank?: number;
  chocolateyDownloads?: number;
}

/**
 * Search for packages in the curated app catalog
 */
export async function searchPackages(
  query: string,
  limit: number = 50,
  category?: string
): Promise<NormalizedPackage[]> {
  if (!query || query.trim().length < 2) {
    return [];
  }

  try {
    const supabase = getSupabaseClient();

    // Search curated apps
    const { data: curatedData, error: curatedError } = await supabase
      .rpc('search_curated_apps', {
        search_query: query,
        category_filter: category || null,
        result_limit: limit,
      });

    if (!curatedError && curatedData && curatedData.length > 0) {
      return curatedData.map(normalizeCuratedApp);
    }

    if (curatedError) {
      console.error('Search error:', curatedError);
    }

    // No results from curated apps
    return [];
  } catch (error) {
    console.error('Error searching packages:', error);
    throw error;
  }
}

/**
 * Get package details by ID
 * Checks curated_apps first, then falls back to manifest API
 */
export async function getPackage(packageId: string): Promise<CuratedPackage | null> {
  if (!packageId) {
    return null;
  }

  try {
    const supabase = getSupabaseClient();

    // Try curated_apps first
    const { data: curatedData } = await supabase
      .from('curated_apps')
      .select('*')
      .eq('winget_id', packageId)
      .single();

    if (curatedData) {
      // Get versions from version_history
      const { data: versionData } = await supabase
        .from('version_history')
        .select('version')
        .eq('winget_id', packageId)
        .order('created_at', { ascending: false });

      const versions = versionData?.map(v => v.version) || [];

      return {
        id: curatedData.winget_id,
        name: curatedData.name,
        publisher: curatedData.publisher,
        version: curatedData.latest_version || versions[0] || '',
        description: curatedData.description,
        homepage: curatedData.homepage,
        license: curatedData.license,
        tags: curatedData.tags || [],
        versions: versions.length > 0 ? versions : undefined,
        iconPath: curatedData.icon_path,
        category: curatedData.category,
        popularityRank: curatedData.popularity_rank,
        chocolateyDownloads: curatedData.chocolatey_downloads,
      };
    }

    // Fallback to manifest API for non-curated apps
    const manifest = await getFullManifest(packageId);
    if (manifest) {
      const versions = await fetchAvailableVersions(packageId);
      return {
        id: manifest.Id,
        name: manifest.Name,
        publisher: manifest.Publisher,
        version: manifest.Version,
        description: manifest.Description,
        homepage: manifest.Homepage,
        license: manifest.License,
        tags: manifest.Tags || [],
        versions: versions.length > 0 ? versions : undefined,
      };
    }

    return null;
  } catch (error) {
    console.error('Error getting package:', error);
    throw error;
  }
}

/**
 * Get all available versions for a package
 */
export async function getPackageVersions(packageId: string): Promise<string[]> {
  try {
    const supabase = getSupabaseClient();

    // Try version_history table first
    const { data } = await supabase
      .from('version_history')
      .select('version')
      .eq('winget_id', packageId)
      .order('created_at', { ascending: false });

    if (data && data.length > 0) {
      return data.map(v => v.version);
    }

    // Fallback to manifest API
    return await fetchAvailableVersions(packageId);
  } catch (error) {
    console.error('Error getting package versions:', error);
    // Last resort: get from package
    const pkg = await getPackage(packageId);
    return pkg?.versions || (pkg?.version ? [pkg.version] : []);
  }
}

/**
 * Get the full manifest for a specific version
 */
export async function getManifest(
  packageId: string,
  version?: string
): Promise<WingetManifest | null> {
  return getFullManifest(packageId, version);
}

/**
 * Get installers for a specific package version
 */
export async function getInstallers(
  packageId: string,
  version?: string
): Promise<NormalizedInstaller[]> {
  return getManifestInstallers(packageId, version);
}

/**
 * Get the best installer for a given architecture preference
 */
export async function getBestInstaller(
  packageId: string,
  version?: string,
  preferredArch: 'x64' | 'x86' | 'arm64' = 'x64'
): Promise<NormalizedInstaller | null> {
  return getManifestBestInstaller(packageId, version, preferredArch);
}

/**
 * Get popular/featured packages from curated catalog
 */
export async function getPopularPackages(
  limit: number = 20,
  category?: string
): Promise<CuratedPackage[]> {
  try {
    const supabase = getSupabaseClient();

    const { data: curatedData, error: curatedError } = await supabase
      .rpc('get_popular_curated_apps', {
        result_limit: limit,
        category_filter: category || null,
      });

    if (curatedError) {
      console.error('Error getting popular packages:', curatedError);
      return [];
    }

    if (curatedData && curatedData.length > 0) {
      return curatedData.map(normalizeCuratedApp);
    }

    return [];
  } catch (error) {
    console.error('Error getting popular packages:', error);
    return [];
  }
}

/**
 * Get available categories from curated catalog
 */
export async function getCategories(): Promise<{ category: string; count: number }[]> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.rpc('get_curated_categories');

    if (error) {
      console.error('Error getting categories:', error);
      return [];
    }

    return (data || []).map((c: { category: string; app_count: number }) => ({
      category: c.category,
      count: c.app_count,
    }));
  } catch (error) {
    console.error('Error getting categories:', error);
    return [];
  }
}

/**
 * Get installation changelog for an app
 */
export async function getInstallationChangelog(
  wingetId: string,
  version?: string
): Promise<InstallationSnapshot | null> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .rpc('get_installation_changelog', {
        app_winget_id: wingetId,
        app_version: version || null,
      });

    if (error || !data || data.length === 0) {
      return null;
    }

    return data[0] as InstallationSnapshot;
  } catch (error) {
    console.error('Error getting installation changelog:', error);
    return null;
  }
}

/**
 * Registry entry from installation scan
 */
export interface RegistryEntry {
  key_name: string;
  registry_path?: string;
  display_name?: string;
  display_version?: string;
  publisher?: string;
  install_location?: string;
  uninstall_string?: string;
  quiet_uninstall_string?: string;
  estimated_size_kb?: number;
  detection_method?: 'new_key' | 'fallback_search';
}

/**
 * Shortcut entry from installation scan
 */
export interface ShortcutEntry {
  name: string;
  path: string;
  created?: string;
  detection_method?: string;
}

/**
 * Service entry from installation scan
 */
export interface ServiceEntry {
  name: string;
  display_name: string;
  start_type: string;
}

/**
 * File entry from installation scan
 */
export interface FileEntry {
  path: string;
  size: number;
  extension: string;
}

/**
 * Installation snapshot type
 */
export interface InstallationSnapshot {
  winget_id: string;
  version: string;
  scanned_at: string;
  scan_status: string;
  registry_changes: {
    added: RegistryEntry[];
    app_registry_entry?: RegistryEntry;
  };
  file_changes: {
    added: FileEntry[];
    file_count: number;
  };
  shortcuts_created: ShortcutEntry[];
  services_created: ServiceEntry[];
  install_path: string | null;
  uninstall_string: string | null;
  quiet_uninstall_string: string | null;
  installed_size_bytes: number | null;
}

// Helper functions

function normalizeCuratedApp(app: Record<string, unknown>): CuratedPackage {
  return {
    id: app.winget_id as string,
    name: app.name as string,
    publisher: app.publisher as string,
    version: app.latest_version as string || '',
    description: app.description as string | undefined,
    homepage: app.homepage as string | undefined,
    license: undefined,
    tags: app.tags as string[] || [],
    versions: undefined,
    iconPath: app.icon_path as string | undefined,
    category: app.category as string | undefined,
    popularityRank: app.popularity_rank as number | undefined,
    chocolateyDownloads: app.chocolatey_downloads as number | undefined,
  };
}

// Re-export types for convenience
export type { NormalizedPackage, NormalizedInstaller, WingetManifest, WingetInstaller, WingetInstallerType };
