/**
 * Catalog Source abstraction
 *
 * Defines the read surface over the app catalog (curated_apps,
 * version_history, sccm_winget_mappings, and the catalog RPCs). Every
 * catalog read in the app goes through a CatalogSource implementation so the
 * backing store (Supabase today, a downloaded SQLite snapshot later) can be
 * swapped without touching call sites.
 *
 * Phase 1: the only implementation is SupabaseCatalogSource, which contains
 * the queries moved verbatim from their original call sites. No behavior
 * change.
 */

import type { LocaleVariant } from '@/types/winget';
import type { SccmMatchResult } from '@/lib/matching/sccm-matcher';
import type { CuratedAppMatch } from '@/lib/app-mappings';
import type { InstallationSnapshot } from '@/lib/winget-api';

/**
 * Raw row returned by the search_curated_apps / get_popular_curated_apps RPCs.
 */
export interface CuratedAppRpcRow {
  id: number;
  winget_id: string;
  name: string;
  publisher: string;
  latest_version: string;
  description: string | null;
  homepage: string | null;
  category: string | null;
  tags: string[] | null;
  icon_path: string | null;
  popularity_rank: number | null;
  installer_type?: string | null;
  rank?: number;
  app_source: string | null;
  store_package_id: string | null;
}

/**
 * Row shape returned by the curated_apps data query in /api/winget/popular.
 */
export interface PopularCuratedAppRow {
  id: number;
  winget_id: string;
  name: string;
  publisher: string;
  latest_version: string;
  description: string | null;
  homepage: string | null;
  category: string | null;
  tags: string[] | null;
  icon_path: string | null;
  popularity_rank: number | null;
  app_source: string | null;
  store_package_id: string | null;
}

export interface PopularPackagesResult {
  data: PopularCuratedAppRow[];
  total: number;
}

export type SearchSort = 'popular' | 'name' | 'newest';

/**
 * Full curated_apps row (select('*')) used by getPackage.
 */
export interface CuratedAppFullRow {
  winget_id: string;
  name: string;
  publisher: string;
  latest_version: string | null;
  description?: string;
  homepage?: string;
  license?: string;
  tags?: string[] | null;
  icon_path?: string;
  category?: string;
  popularity_rank?: number;
  is_locale_variant?: boolean;
  parent_winget_id?: string | null;
  locale_code?: string | null;
  is_verified?: boolean;
  app_source?: string | null;
  store_package_id?: string | null;
  [key: string]: unknown;
}

/**
 * Combined curated app + versions + locale variants returned by
 * getAppByWingetId (the curated portion of getPackage).
 */
export interface CuratedAppWithDetails {
  app: CuratedAppFullRow;
  versions: string[];
  localeVariants?: LocaleVariant[];
}

export interface CategoryCount {
  category: string;
  count: number;
}

/**
 * Installer metadata from version_history. Different callers select different
 * column subsets; this is the union so a single method can serve each caller.
 * Callers ignore the fields they did not originally request.
 */
export interface VersionInstallerInfo {
  installer_url: string | null;
  installer_sha256: string | null;
  installer_type: string | null;
  installer_scope?: string | null;
  installers: unknown;
}

export interface WingetIdLatestVersion {
  winget_id: string;
  latest_version: string | null;
}

/**
 * Curated app metadata used by the SCCM migrate route (fetchWingetPackage).
 */
export interface SccmCuratedAppRow {
  winget_id: string;
  name: string;
  publisher: string;
  latest_version: string | null;
  description: string | null;
  homepage: string | null;
  license: string | null;
  tags: string[] | null;
  category: string | null;
  icon_path: string | null;
}

export interface SccmMappingQuery {
  displayNameNormalized: string;
  ciId: string;
  productCode: string | null;
}

/**
 * Subset of SccmMatchResult fields the catalog source can derive from a
 * mapping row. The matcher adds matchedBy/confidence semantics; the source
 * returns the raw resolution.
 */
export type SccmMappingResult = SccmMatchResult;

/**
 * The catalog read surface. Every method maps 1:1 to a former direct query.
 */
export interface CatalogSource {
  // --- search / discovery ---

  /** RPC search_curated_apps. Returns the raw rows + error so each caller keeps
   *  its own error-handling (winget-api logs+throws; the route returns null). */
  searchApps(
    query: string,
    opts: { limit: number; category?: string | null; sort?: SearchSort }
  ): Promise<{ data: CuratedAppRpcRow[] | null; error: { message: string } | null }>;

  /** curated_apps count + data query from /api/winget/popular getCuratedPackages. */
  getPopularApps(opts: {
    limit: number;
    offset: number;
    category?: string | null;
    sort: SearchSort;
  }): Promise<PopularPackagesResult | null>;

  /** RPC get_popular_curated_apps (normalized in winget-api). */
  getPopularPackages(
    limit: number,
    category?: string | null
  ): Promise<{ data: CuratedAppRpcRow[] | null; error: { message: string } | null }>;

  /** RPC get_curated_categories. */
  getCategories(): Promise<CategoryCount[]>;

  /** curated_apps count(head) with optional is_verified filter. */
  getCategoryCount(opts: { verifiedOnly: boolean }): Promise<number | null>;

  // --- app detail ---

  /** curated_apps select('*') + version_history versions + get_locale_variants. */
  getAppByWingetId(wingetId: string): Promise<CuratedAppWithDetails | null>;

  /** version_history select('version') ordered by created_at desc. */
  getVersions(wingetId: string): Promise<string[]>;

  /** version_history installer info for a specific version. */
  getVersionInstallerInfo(
    wingetId: string,
    version: string
  ): Promise<VersionInstallerInfo | null>;

  /** version_history installer info for a version, taking the most recently
   *  created row (order created_at desc, limit 1) — batch-orchestrator variant. */
  getLatestVersionInstallerInfo(
    wingetId: string,
    version: string
  ): Promise<VersionInstallerInfo | null>;

  /** RPC get_installation_changelog. */
  getInstallationChangelog(
    wingetId: string,
    version?: string
  ): Promise<InstallationSnapshot | null>;

  // --- update detection ---

  /** curated_apps latest versions for a set of winget ids (.in). */
  getAppsByWingetIds(ids: string[]): Promise<WingetIdLatestVersion[]>;

  /** curated_apps all rows with non-null latest_version. */
  getAllLatestVersions(): Promise<WingetIdLatestVersion[]>;

  // --- small metadata lookups ---

  /** curated_apps name+publisher (.single) for buildDefaultDeploymentConfig. */
  getAppNamePublisher(
    wingetId: string
  ): Promise<{ name: string; publisher: string | null } | null>;

  /** curated_apps winget_id+name+latest_version (.single) for getLatestInstallerInfo. */
  getAppForInstaller(wingetId: string): Promise<{
    winget_id: string;
    name: string;
    latest_version: string | null;
  } | null>;

  /** curated_apps metadata column set for the SCCM migrate route. */
  getSccmCuratedApp(wingetId: string): Promise<SccmCuratedAppRow | null>;

  /** curated_apps description (.maybeSingle) for batch-orchestrator. */
  getAppDescription(wingetId: string): Promise<string | undefined>;

  // --- matching ---

  /** searchCuratedApps body from lib/app-mappings (ILIKE on name/publisher/id). */
  searchCuratedAppsForMatching(term: string): Promise<CuratedAppMatch[]>;

  /** sccm_winget_mappings resolution from lib/matching/sccm-matcher checkSccmMapping. */
  getSccmMapping(query: SccmMappingQuery, tenantId: string): Promise<SccmMappingResult | null>;

  // --- existence checks ---

  /** curated_apps id+winget_id (.single) exact-match existence. */
  appExists(wingetId: string): Promise<boolean>;

  /** curated_apps id+winget_id (.ilike .maybeSingle) case-insensitive existence. */
  appExistsCaseInsensitive(wingetId: string): Promise<{ winget_id: string } | null>;

  /** curated_apps similar verified apps for the suggestions hint (.or ILIKE). */
  findSimilarVerifiedApps(
    term: string,
    limit: number
  ): Promise<{ winget_id: string; name: string }[]>;

  // --- stats ---

  /** curated_apps count(head) for /api/stats/public. */
  getCatalogStats(): Promise<{ totalApps: number }>;
}
