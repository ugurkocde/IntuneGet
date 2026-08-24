/**
 * Supabase-backed CatalogSource.
 *
 * Each method contains the catalog query moved verbatim from its original
 * call site. The two client constructions used by the original code are
 * preserved exactly:
 *  - `serviceOrAnonClient()` -> createClient(url, SERVICE_ROLE_KEY || ANON_KEY)
 *    (used by winget-api.ts, manifest-api.ts and the winget/* routes)
 *  - `createServerClient()` -> service-role-only typed client
 *    (used by community/sccm/stats/auto-update call sites)
 *
 * Where it does not change which key is used, the original helper is reused.
 */

import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase';
import { getLocaleDisplay } from '@/lib/locale-utils';
import type { LocaleVariant } from '@/types/winget';
import type { CuratedAppMatch } from '@/lib/app-mappings';
import type { InstallationSnapshot } from '@/lib/winget-api';
import type { QaCandidateStatusRow, QaResultRow, QaStatusRow } from '@/types/qa';
import type {
  CatalogSource,
  CategoryCount,
  CuratedAppRpcRow,
  CuratedAppWithDetails,
  PopularPackagesResult,
  SccmCuratedAppRow,
  SccmMappingQuery,
  SccmMappingResult,
  SearchSort,
  VersionInstallerInfo,
  WingetIdLatestVersion,
} from './types';

/**
 * Raw Supabase client using the service-or-anon key, matching the
 * getSupabaseClient() helpers previously inlined in winget-api.ts and
 * manifest-api.ts. Returns null when unconfigured (manifest-api semantics);
 * throwing variants handle the missing-config case at the call site.
 */
function serviceOrAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key);
}

let warnedMissingQaServiceRole = false;

export class SupabaseCatalogSource implements CatalogSource {
  // ---------------------------------------------------------------------------
  // search / discovery
  // ---------------------------------------------------------------------------

  async searchApps(
    query: string,
    opts: { limit: number; category?: string | null; sort?: SearchSort }
  ): Promise<{ data: CuratedAppRpcRow[] | null; error: { message: string } | null }> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return { data: null, error: { message: 'Supabase configuration missing' } };
    }

    const { data: curatedData, error: curatedError } = await supabase.rpc(
      'search_curated_apps',
      {
        search_query: query,
        category_filter: opts.category || null,
        result_limit: opts.limit,
      }
    );

    return {
      data: curatedData
        ? (curatedData as CuratedAppRpcRow[]).filter((app) => app.latest_version != null)
        : null,
      error: curatedError,
    };
  }

  async getPopularApps(opts: {
    limit: number;
    offset: number;
    category?: string | null;
    sort: SearchSort;
    verifiedOnly?: boolean;
  }): Promise<PopularPackagesResult | null> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return null;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { limit, offset, category, sort, verifiedOnly = true } = opts;

    let baseQuery = supabase
      .from('curated_apps')
      .select('*', { count: 'exact', head: true })
      .not('latest_version', 'is', null)
      .eq('is_locale_variant', false);

    if (verifiedOnly) {
      baseQuery = baseQuery.eq('is_verified', true);
    }

    const countQuery = category ? baseQuery.eq('category', category) : baseQuery;
    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      console.error('Failed to count curated packages', { error: countError, category });
      return null;
    }

    let dataQuery = supabase
      .from('curated_apps')
      .select(
        'id, winget_id, name, publisher, latest_version, description, homepage, category, tags, icon_path, popularity_rank, app_source, store_package_id'
      )
      .not('latest_version', 'is', null)
      .eq('is_locale_variant', false);

    if (verifiedOnly) {
      dataQuery = dataQuery.eq('is_verified', true);
    }

    if (category) {
      dataQuery = dataQuery.eq('category', category);
    }

    switch (sort) {
      case 'name':
        dataQuery = dataQuery.order('name', { ascending: true });
        break;
      case 'newest':
        dataQuery = dataQuery.order('created_at', { ascending: false });
        break;
      case 'popular':
      default:
        dataQuery = dataQuery
          .order('popularity_rank', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true });
        break;
    }

    const { data, error } = await dataQuery.range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to query curated packages', { error, category, sort, limit, offset });
      return null;
    }

    return {
      data: (data || []) as PopularPackagesResult['data'],
      total: totalCount || 0,
    };
  }

  async getPopularPackages(
    limit: number,
    category?: string | null
  ): Promise<{ data: CuratedAppRpcRow[] | null; error: { message: string } | null }> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return { data: null, error: { message: 'Supabase configuration missing' } };
    }

    const { data: curatedData, error: curatedError } = await supabase.rpc(
      'get_popular_curated_apps',
      {
        result_limit: limit,
        category_filter: category || null,
      }
    );

    return {
      data: curatedData
        ? (curatedData as CuratedAppRpcRow[]).filter((app) => app.latest_version != null)
        : null,
      error: curatedError,
    };
  }

  async getCategories(): Promise<CategoryCount[]> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return [];
    }

    const { data, error } = await supabase.rpc('get_curated_categories');

    if (error) {
      console.error('Error getting categories:', error);
      return [];
    }

    return ((data || []) as { category: string; app_count: number }[]).map((c) => ({
      category: c.category,
      count: c.app_count,
    }));
  }

  async getVerifiedAppIds(limit?: number): Promise<{ winget_id: string }[]> {
    const supabase = serviceOrAnonClient();
    if (!supabase) return [];

    const pageSize = limit === undefined ? 1000 : Math.min(limit, 1000);
    const rows: { winget_id: string }[] = [];
    let offset = 0;

    while (limit === undefined || rows.length < limit) {
      const requested = limit === undefined ? pageSize : Math.min(pageSize, limit - rows.length);
      const { data, error } = await supabase
        .from('curated_apps')
        .select('winget_id')
        .eq('is_verified', true)
        .eq('is_locale_variant', false)
        .not('latest_version', 'is', null)
        .order('popularity_rank', { ascending: true, nullsFirst: false })
        .order('winget_id', { ascending: true })
        .range(offset, offset + requested - 1);

      if (error) {
        console.error('Failed to list verified catalog apps:', error.message);
        return rows;
      }
      const page = (data || []) as { winget_id: string }[];
      rows.push(...page);
      if (page.length < requested) break;
      offset += page.length;
    }
    return rows;
  }

  async getCategoryCount(opts: { verifiedOnly: boolean }): Promise<number | null> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return null;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    let query = supabase
      .from('curated_apps')
      .select('*', { count: 'exact', head: true });

    if (opts.verifiedOnly) {
      query = query.eq('is_verified', true);
    }
    query = query.not('latest_version', 'is', null);

    const { count } = await query;
    return count ?? null;
  }

  // ---------------------------------------------------------------------------
  // app detail
  // ---------------------------------------------------------------------------

  async getAppByWingetId(wingetId: string): Promise<CuratedAppWithDetails | null> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return null;
    }

    const { data: curatedData } = await supabase
      .from('curated_apps')
      .select('*')
      .eq('winget_id', wingetId)
      .single();

    if (!curatedData) {
      return null;
    }

    // Get versions from version_history
    const { data: versionData } = await supabase
      .from('version_history')
      .select('version')
      .eq('winget_id', wingetId)
      .order('created_at', { ascending: false });

    const versions = versionData?.map((v) => v.version) || [];

    // Fetch locale variants if this is a parent app (not a variant itself)
    let localeVariants: LocaleVariant[] | undefined;
    if (!curatedData.is_locale_variant) {
      const { data: variantData } = await supabase.rpc('get_locale_variants', {
        parent_id: wingetId,
      });
      if (variantData && variantData.length > 0) {
        localeVariants = variantData.map(
          (v: { winget_id: string; locale_code: string; latest_version: string | null }) => {
            const display = getLocaleDisplay(v.locale_code);
            return {
              wingetId: v.winget_id,
              localeCode: v.locale_code,
              localeName: display.name,
              countryFlag: display.flag,
              version: v.latest_version || undefined,
            };
          }
        );
      }
    }

    return {
      app: curatedData as CuratedAppWithDetails['app'],
      versions,
      localeVariants,
    };
  }

  async getVersions(wingetId: string): Promise<string[]> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return [];
    }

    const { data } = await supabase
      .from('version_history')
      .select('version')
      .eq('winget_id', wingetId)
      .order('created_at', { ascending: false });

    if (data && data.length > 0) {
      return data.map((v) => v.version);
    }

    return [];
  }

  async getVersionInstallerInfo(
    wingetId: string,
    version: string
  ): Promise<VersionInstallerInfo | null> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('version_history')
      .select('installer_url, installer_sha256, installer_type, installer_scope, silent_args, installers')
      .eq('winget_id', wingetId)
      .eq('version', version)
      .single();

    if (error || !data) {
      return null;
    }

    return data as unknown as VersionInstallerInfo;
  }

  async getLatestVersionInstallerInfo(
    wingetId: string,
    version: string
  ): Promise<VersionInstallerInfo | null> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('version_history')
      .select('installer_url, installer_sha256, installer_type, installer_scope, silent_args, installers')
      .eq('winget_id', wingetId)
      .eq('version', version)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return data as unknown as VersionInstallerInfo;
  }

  async getInstallationChangelog(
    wingetId: string,
    version?: string
  ): Promise<InstallationSnapshot | null> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return null;
    }

    const { data, error } = await supabase.rpc('get_installation_changelog', {
      app_winget_id: wingetId,
      app_version: version || null,
    });

    if (error || !data || data.length === 0) {
      return null;
    }

    return data[0] as InstallationSnapshot;
  }

  async getQaStatuses(ids: string[]): Promise<QaStatusRow[]> {
    if (ids.length === 0) return [];

    const supabase = serviceOrAnonClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('qa_results')
      .select(
        'winget_id, outcome, tested_version, architecture, tested_at_utc, test_level, package_profile_sha256'
      )
      .in('winget_id', ids)
      .eq('test_level', 'psadt-package');

    if (error) {
      console.error('Failed to read QA statuses:', error.message);
      return [];
    }

    return (data || []) as QaStatusRow[];
  }

  async getQaResult(
    wingetId: string,
    packageProfileSha256?: string
  ): Promise<QaResultRow | null> {
    if (packageProfileSha256) {
      const supabase = createServerClient();
      const { data, error } = await supabase
        .from('qa_package_results')
        .select(
          'package_profile_sha256, winget_id, display_name, publisher, tested_version, architecture, installer_sha256, outcome, tested_at_utc, overall_duration_seconds, installer_type, install_command, uninstall_command, detection, phase_results, changes, relevant_event_count, environment, effective_configuration, qa_schema_version, psadt_version, psadt_template_sha256, psadt_config_sha256, detection_rules_sha256, packager_commit, package_content_sha256, virustotal_status, virustotal_malicious, virustotal_suspicious, virustotal_total_engines, virustotal_scanned_at_utc'
        )
        .eq('winget_id', wingetId)
        .eq('package_profile_sha256', packageProfileSha256.toUpperCase())
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to read exact QA package result: ${error.message}`);
      }
      if (!data?.detection || !data.phase_results || !data.install_command || !data.uninstall_command) {
        return null;
      }

      return {
        ...data,
        display_name: data.display_name || wingetId,
        publisher: data.publisher || '',
        test_level: 'psadt-package',
      } as unknown as QaResultRow;
    }

    const supabase = serviceOrAnonClient();
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('qa_results')
      .select(
        'winget_id, display_name, publisher, tested_version, architecture, outcome, tested_at_utc, installer_sha256, overall_duration_seconds, installer_type, install_command, uninstall_command, detection, phase_results, changes, relevant_event_count, environment, effective_configuration, qa_schema_version, synced_at, test_level, package_profile_sha256, psadt_version, psadt_template_sha256, psadt_config_sha256, detection_rules_sha256, packager_commit, package_content_sha256, virustotal_status, virustotal_malicious, virustotal_suspicious, virustotal_total_engines, virustotal_scanned_at_utc'
      )
      .eq('winget_id', wingetId)
      .eq('test_level', 'psadt-package')
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to read QA result: ${error.message}`);
    }

    return (data as QaResultRow | null) || null;
  }

  async getQaCandidateStatuses(ids: string[]): Promise<QaCandidateStatusRow[]> {
    if (ids.length === 0) return [];
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      if (!warnedMissingQaServiceRole) {
        console.warn(
          'QA queued/running statuses are unavailable because SUPABASE_SERVICE_ROLE_KEY is not configured.'
        );
        warnedMissingQaServiceRole = true;
      }
      return [];
    }
    const supabase = serviceOrAnonClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('qa_candidates')
      .select(
        'winget_id, version, architecture, installer_sha256, status, enqueued_at, started_at, test_level, package_profile_sha256'
      )
      .in('winget_id', ids)
      .eq('test_level', 'psadt-package')
      .in('status', ['queued', 'dispatched', 'running'])
      .order('enqueued_at', { ascending: false });
    if (error) {
      console.error('Failed to read QA candidate statuses:', error.message);
      return [];
    }

    const latest = new Map<string, QaCandidateStatusRow>();
    for (const row of (data || []) as QaCandidateStatusRow[]) {
      if (!latest.has(row.winget_id)) latest.set(row.winget_id, row);
    }
    return [...latest.values()];
  }

  // ---------------------------------------------------------------------------
  // update detection
  // ---------------------------------------------------------------------------

  async getAppsByWingetIds(ids: string[]): Promise<WingetIdLatestVersion[]> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('curated_apps')
      .select('winget_id, latest_version')
      .in('winget_id', ids);

    if (error || !data) {
      return [];
    }

    return data as WingetIdLatestVersion[];
  }

  async getAllLatestVersions(): Promise<WingetIdLatestVersion[]> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('curated_apps')
      .select('winget_id, latest_version')
      .not('latest_version', 'is', null);

    // Preserve the original cron behavior: propagate the error so the route's
    // outer try/catch returns a 500 (it did `throw curatedError`).
    if (error) {
      throw error;
    }

    return (data || []) as WingetIdLatestVersion[];
  }

  // ---------------------------------------------------------------------------
  // small metadata lookups
  // ---------------------------------------------------------------------------

  async getAppNamePublisher(
    wingetId: string
  ): Promise<{ name: string; publisher: string | null } | null> {
    const supabase = createServerClient();

    const { data } = await supabase
      .from('curated_apps')
      .select('name, publisher')
      .eq('winget_id', wingetId)
      .single();

    if (!data) {
      return null;
    }

    return data as { name: string; publisher: string | null };
  }

  async getAppForInstaller(wingetId: string): Promise<{
    winget_id: string;
    name: string;
    latest_version: string | null;
  } | null> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('curated_apps')
      .select('winget_id, name, latest_version')
      .eq('winget_id', wingetId)
      .single();

    if (error || !data) {
      return null;
    }

    return data as { winget_id: string; name: string; latest_version: string | null };
  }

  async getSccmCuratedApp(wingetId: string): Promise<SccmCuratedAppRow | null> {
    const supabase = createServerClient();

    const { data, error } = (await supabase
      .from('curated_apps')
      .select(
        'winget_id, name, publisher, latest_version, description, homepage, license, tags, category, icon_path'
      )
      .eq('winget_id', wingetId)
      .single()) as { data: SccmCuratedAppRow | null; error: Error | null };

    if (error || !data) {
      return null;
    }

    return data;
  }

  async getAppDescription(wingetId: string): Promise<string | undefined> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('curated_apps')
      .select('description')
      .eq('winget_id', wingetId)
      .limit(1)
      .maybeSingle();

    if (error || !data?.description || typeof data.description !== 'string') {
      return undefined;
    }

    return data.description;
  }

  // ---------------------------------------------------------------------------
  // matching
  // ---------------------------------------------------------------------------

  async searchCuratedAppsForMatching(term: string): Promise<CuratedAppMatch[]> {
    if (!term || term.length < 2) {
      return [];
    }

    const normalizedSearch = term.toLowerCase().trim();
    const supabase = createServerClient();

    try {
      const { data, error } = await supabase
        .from('curated_apps')
        .select('winget_id, name, publisher, latest_version')
        .not('latest_version', 'is', null)
        .or(
          `name.ilike.%${normalizedSearch}%,publisher.ilike.%${normalizedSearch}%,winget_id.ilike.%${normalizedSearch}%`
        )
        .order('popularity_rank', { ascending: true, nullsFirst: false })
        .limit(10);

      if (error) {
        console.error('Error searching curated apps:', error.message);
        return [];
      }

      if (!data || data.length === 0) {
        return [];
      }

      return (
        data as Array<{
          winget_id: string;
          name: string;
          publisher: string;
          latest_version: string | null;
        }>
      ).map((app) => ({
        wingetId: app.winget_id,
        name: app.name,
        publisher: app.publisher,
        latestVersion: app.latest_version,
      }));
    } catch (e) {
      console.error('Failed to search curated apps:', e);
      return [];
    }
  }

  async getSccmMapping(
    query: SccmMappingQuery,
    tenantId: string
  ): Promise<SccmMappingResult | null> {
    const supabase = createServerClient();

    const { displayNameNormalized, ciId, productCode } = query;

    // sccm_winget_mappings columns are snake_case. Read the row with the actual
    // column names: reading camelCase here returned undefined and threw on
    // wingetPackageId.split(...), which surfaced as a 500 on Run Matching for any
    // app that hit a seeded mapping (e.g. "google chrome").
    type SccmWingetMappingRow = {
      id: string;
      winget_package_id: string | null;
      winget_package_name: string | null;
      confidence: number | null;
      is_verified: boolean | null;
      tenant_id: string | null;
      sccm_product_code: string | null;
    };

    // Build the OR conditions defensively: quote values so names containing
    // spaces or parentheses (e.g. "Zoom Workplace (64-bit)") don't break the
    // PostgREST or() parser, and only filter on product code when one exists
    // (eq.null would not match NULL rows anyway).
    const quote = (v: string) => `"${v.replace(/"/g, '')}"`;
    const orConditions = [
      `sccm_display_name_normalized.eq.${quote(displayNameNormalized)}`,
      `sccm_ci_id.eq.${quote(ciId)}`,
    ];
    if (productCode) {
      orConditions.push(`sccm_product_code.eq.${quote(productCode)}`);
    }

    // sccm_winget_mappings is not in the generated Database types; use the
    // same loosely-typed access shape the original checkSccmMapping used.
    const looseClient = supabase as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          or: (filter: string) => {
            order: (column: string, options: { ascending: boolean }) => {
              limit: (count: number) => Promise<{
                data: SccmWingetMappingRow[] | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };

    const { data, error } = await looseClient
      .from('sccm_winget_mappings')
      .select('*')
      .or(orConditions.join(','))
      .order('is_verified', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      return null;
    }

    const mapping = data[0];

    // Check tenant scope
    if (mapping.tenant_id && mapping.tenant_id !== tenantId) {
      return null;
    }

    // Guard against a mapping row without a winget package id.
    const wingetId = mapping.winget_package_id;
    if (!wingetId) {
      return null;
    }

    return {
      status: 'matched',
      wingetId,
      wingetName: mapping.winget_package_name || wingetId.split('.').pop() || wingetId,
      confidence: mapping.confidence ?? 1.0,
      partialMatches: [],
      matchedBy: mapping.sccm_product_code && productCode ? 'product_code' : 'mapping',
      mappingId: mapping.id,
    };
  }

  // ---------------------------------------------------------------------------
  // existence checks
  // ---------------------------------------------------------------------------

  async appExists(wingetId: string): Promise<boolean> {
    const supabase = createServerClient();

    const { data } = await supabase
      .from('curated_apps')
      .select('id, winget_id')
      .eq('winget_id', wingetId)
      .single();

    return Boolean(data);
  }

  async appExistsCaseInsensitive(
    wingetId: string
  ): Promise<{ winget_id: string } | null> {
    const supabase = createServerClient();

    const { data } = await supabase
      .from('curated_apps')
      .select('id, winget_id')
      .ilike('winget_id', wingetId)
      .limit(1)
      .maybeSingle();

    return (data as { winget_id: string } | null) || null;
  }

  async findSimilarVerifiedApps(
    term: string,
    limit: number
  ): Promise<{ winget_id: string; name: string }[]> {
    const supabase = createServerClient();

    const { data } = await supabase
      .from('curated_apps')
      .select('winget_id, name')
      .or(`winget_id.ilike.%${term}%,name.ilike.%${term}%`)
      .eq('is_verified', true)
      .limit(limit);

    return (data as { winget_id: string; name: string }[] | null) || [];
  }

  // ---------------------------------------------------------------------------
  // stats
  // ---------------------------------------------------------------------------

  async getCatalogStats(): Promise<{ totalApps: number }> {
    // The stats route builds its own client (service-role-only) and runs this
    // count alongside a site_counters query; here we only own the catalog count.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return { totalApps: 0 };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { count } = await supabase
      .from('curated_apps')
      .select('*', { count: 'exact', head: true });

    return { totalApps: count ?? 0 };
  }
}
