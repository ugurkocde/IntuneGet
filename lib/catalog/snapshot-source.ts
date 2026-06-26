/**
 * SQLite-snapshot-backed CatalogSource (self-hosted / Supabase-less mode).
 *
 * Answers every CatalogSource method by querying the downloaded, verified
 * catalog snapshot (see snapshot-store.ts) instead of Supabase. Each method
 * mirrors the return shape and degradation behavior of SupabaseCatalogSource:
 * when the snapshot is unavailable, methods that return `{ data, error }`
 * surface the error, and methods that return null/[]/undefined degrade to
 * their empty value rather than throwing.
 *
 * Native dependencies (node:fs, better-sqlite3) are only reachable through
 * snapshot-store.ts, which is lazy-loaded by the catalog selector so nothing
 * here is pulled into Supabase-mode or edge bundles.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { getSnapshotDb, SnapshotUnavailableError } from './snapshot-store';
import { getLocaleDisplay } from '@/lib/locale-utils';
import type { LocaleVariant } from '@/types/winget';
import type { CuratedAppMatch } from '@/lib/app-mappings';
import type { InstallationSnapshot } from '@/lib/winget-api';
import type {
  CatalogSource,
  CategoryCount,
  CuratedAppRpcRow,
  CuratedAppWithDetails,
  PopularCuratedAppRow,
  PopularPackagesResult,
  SccmCuratedAppRow,
  SccmMappingQuery,
  SccmMappingResult,
  SearchSort,
  VersionInstallerInfo,
  WingetIdLatestVersion,
} from './types';

type DB = BetterSqlite3.Database;

/**
 * Run a snapshot query, degrading gracefully when the snapshot is unavailable.
 * `onUnavailable` provides the per-method empty value so each method matches
 * the corresponding SupabaseCatalogSource degradation semantics.
 */
async function withDb<T>(
  run: (db: DB) => T,
  onUnavailable: () => T
): Promise<T> {
  let db: DB;
  try {
    db = await getSnapshotDb();
  } catch (err) {
    if (err instanceof SnapshotUnavailableError) {
      return onUnavailable();
    }
    throw err;
  }
  return run(db);
}

/** Columns selected for the RPC-row mapping (curated_apps). */
interface CuratedAppDbRow {
  id: number;
  winget_id: string;
  name: string;
  publisher: string;
  latest_version: string | null;
  description: string | null;
  homepage: string | null;
  category: string | null;
  tags: string | null;
  icon_path: string | null;
  popularity_rank: number | null;
  app_source: string | null;
  store_package_id: string | null;
}

function parseTags(tags: string | null): string[] | null {
  if (!tags) return null;
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function toRpcRow(r: CuratedAppDbRow): CuratedAppRpcRow {
  return {
    id: r.id,
    winget_id: r.winget_id,
    name: r.name,
    publisher: r.publisher,
    latest_version: r.latest_version ?? '',
    description: r.description,
    homepage: r.homepage,
    category: r.category,
    tags: parseTags(r.tags),
    icon_path: r.icon_path,
    popularity_rank: r.popularity_rank,
    // installer_type is not carried in the curated_apps snapshot table.
    installer_type: null,
    app_source: r.app_source,
    store_package_id: r.store_package_id,
  };
}

function toPopularRow(r: CuratedAppDbRow): PopularCuratedAppRow {
  return {
    id: r.id,
    winget_id: r.winget_id,
    name: r.name,
    publisher: r.publisher,
    latest_version: r.latest_version ?? '',
    description: r.description,
    homepage: r.homepage,
    category: r.category,
    tags: parseTags(r.tags),
    icon_path: r.icon_path,
    popularity_rank: r.popularity_rank,
    app_source: r.app_source,
    store_package_id: r.store_package_id,
  };
}

const CURATED_RPC_COLUMNS =
  'id, winget_id, name, publisher, latest_version, description, homepage, category, tags, icon_path, popularity_rank, app_source, store_package_id';

/**
 * Build a safe FTS5 MATCH expression from user input. Splits into terms,
 * strips FTS5 special characters, quotes each term, and joins with spaces
 * (implicit AND). Returns null when no usable term remains (caller falls back
 * to ILIKE). Never passes raw user input to MATCH.
 */
function buildFtsMatch(query: string): string | null {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/["*^():\-+]/g, '').trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"`).join(' ');
}

export class SnapshotCatalogSource implements CatalogSource {
  // ---------------------------------------------------------------------------
  // search / discovery
  // ---------------------------------------------------------------------------

  async searchApps(
    query: string,
    opts: { limit: number; category?: string | null; sort?: SearchSort }
  ): Promise<{ data: CuratedAppRpcRow[] | null; error: { message: string } | null }> {
    return withDb<{ data: CuratedAppRpcRow[] | null; error: { message: string } | null }>(
      (db) => {
        const category = opts.category || null;
        const limit = opts.limit;
        const ftsMatch = buildFtsMatch(query);

        const categoryClause = category ? 'AND ca.category = @category' : '';
        const params: Record<string, unknown> = {
          q: query,
          limit,
          ...(category ? { category } : {}),
        };

        let rows: CuratedAppDbRow[] = [];

        if (ftsMatch) {
          // FTS path: relevance bucket, then bm25, then popularity (nulls last).
          const ftsSql = `
            SELECT ${CURATED_RPC_COLUMNS.split(', ').map((c) => `ca.${c}`).join(', ')}
            FROM curated_fts f
            JOIN curated_apps ca ON ca.id = f.rowid
            WHERE curated_fts MATCH @match
              AND ca.is_verified = 1
              AND ca.is_locale_variant = 0
              ${categoryClause}
            ORDER BY
              CASE
                WHEN lower(ca.name) = lower(@q) OR lower(ca.winget_id) = lower(@q) OR ca.winget_id LIKE '%.' || @q THEN 0
                WHEN lower(ca.name) LIKE lower(@q) || '%' OR ca.winget_id LIKE '%.' || @q || '%' THEN 1
                ELSE 2
              END,
              -- Weight name matches highest, then publisher/tags, then
              -- description. Mirrors the weighted tsvector the Postgres catalog
              -- uses, so a name hit beats an incidental description hit. Column
              -- order matches the curated_fts(name, publisher, description, tags)
              -- definition; lower bm25 = better.
              bm25(curated_fts, 10.0, 4.0, 1.0, 2.0) ASC,
              ca.popularity_rank IS NULL,
              ca.popularity_rank ASC
            LIMIT @limit
          `;
          rows = db
            .prepare(ftsSql)
            .all({ ...params, match: ftsMatch }) as CuratedAppDbRow[];
        }

        // ILIKE fallback when FTS returns nothing (or was skipped).
        if (rows.length === 0) {
          const fallbackSql = `
            SELECT ${CURATED_RPC_COLUMNS}
            FROM curated_apps ca
            WHERE ca.is_verified = 1
              AND ca.is_locale_variant = 0
              ${categoryClause}
              AND (
                ca.name LIKE '%' || @q || '%'
                OR ca.publisher LIKE '%' || @q || '%'
                OR ca.winget_id LIKE '%' || @q || '%'
                OR ca.description LIKE '%' || @q || '%'
              )
            ORDER BY
              CASE
                WHEN lower(ca.name) = lower(@q) OR lower(ca.winget_id) = lower(@q) OR ca.winget_id LIKE '%.' || @q THEN 1
                WHEN lower(ca.name) LIKE lower(@q) || '%' THEN 2
                WHEN ca.winget_id LIKE '%.' || @q || '%' OR ca.name LIKE '%' || @q || '%' THEN 3
                ELSE 4
              END,
              ca.popularity_rank IS NULL,
              ca.popularity_rank ASC
            LIMIT @limit
          `;
          // The fallback selects ca.* columns without the join alias on FTS;
          // re-key params so prepared statement names resolve.
          rows = db.prepare(fallbackSql).all(params) as CuratedAppDbRow[];
        }

        return { data: rows.map(toRpcRow), error: null };
      },
      () => ({ data: null, error: { message: 'Catalog snapshot is not available' } })
    );
  }

  async getPopularApps(opts: {
    limit: number;
    offset: number;
    category?: string | null;
    sort: SearchSort;
  }): Promise<PopularPackagesResult | null> {
    return withDb(
      (db) => {
        const { limit, offset, category, sort } = opts;
        const categoryClause = category ? 'AND category = @category' : '';
        const baseParams: Record<string, unknown> = category ? { category } : {};

        const countRow = db
          .prepare(
            `SELECT COUNT(*) AS c FROM curated_apps
             WHERE is_verified = 1 AND is_locale_variant = 0 ${categoryClause}`
          )
          .get(baseParams) as { c: number };

        let orderBy: string;
        switch (sort) {
          case 'name':
            orderBy = 'name ASC';
            break;
          case 'newest':
            orderBy = 'created_at DESC';
            break;
          case 'popular':
          default:
            orderBy = 'popularity_rank IS NULL, popularity_rank ASC, name ASC';
            break;
        }

        const rows = db
          .prepare(
            `SELECT ${CURATED_RPC_COLUMNS}
             FROM curated_apps
             WHERE is_verified = 1 AND is_locale_variant = 0 ${categoryClause}
             ORDER BY ${orderBy}
             LIMIT @limit OFFSET @offset`
          )
          .all({ ...baseParams, limit, offset }) as CuratedAppDbRow[];

        return {
          data: rows.map(toPopularRow),
          total: countRow.c || 0,
        };
      },
      () => null
    );
  }

  async getPopularPackages(
    limit: number,
    category?: string | null
  ): Promise<{ data: CuratedAppRpcRow[] | null; error: { message: string } | null }> {
    return withDb<{ data: CuratedAppRpcRow[] | null; error: { message: string } | null }>(
      (db) => {
        const cat = category || null;
        const categoryClause = cat ? 'AND category = @category' : '';
        const params: Record<string, unknown> = cat ? { category: cat, limit } : { limit };

        const rows = db
          .prepare(
            `SELECT ${CURATED_RPC_COLUMNS}
             FROM curated_apps
             WHERE is_verified = 1 AND is_locale_variant = 0 ${categoryClause}
             ORDER BY popularity_rank IS NULL, popularity_rank ASC, name ASC
             LIMIT @limit`
          )
          .all(params) as CuratedAppDbRow[];

        return { data: rows.map(toRpcRow), error: null };
      },
      () => ({ data: null, error: { message: 'Catalog snapshot is not available' } })
    );
  }

  async getCategories(): Promise<CategoryCount[]> {
    return withDb(
      (db) => {
        const rows = db
          .prepare(
            `SELECT category, COUNT(*) AS count
             FROM curated_apps
             WHERE is_verified = 1 AND category IS NOT NULL
             GROUP BY category`
          )
          .all() as { category: string; count: number }[];

        return rows.map((r) => ({ category: r.category, count: r.count }));
      },
      () => []
    );
  }

  async getCategoryCount(opts: { verifiedOnly: boolean }): Promise<number | null> {
    return withDb(
      (db) => {
        const where = opts.verifiedOnly ? 'WHERE is_verified = 1' : '';
        const row = db
          .prepare(`SELECT COUNT(*) AS c FROM curated_apps ${where}`)
          .get() as { c: number };
        return row.c ?? null;
      },
      () => null
    );
  }

  // ---------------------------------------------------------------------------
  // app detail
  // ---------------------------------------------------------------------------

  async getAppByWingetId(wingetId: string): Promise<CuratedAppWithDetails | null> {
    return withDb(
      (db) => {
        const app = db
          .prepare(`SELECT * FROM curated_apps WHERE winget_id = ?`)
          .get(wingetId) as Record<string, unknown> | undefined;

        if (!app) {
          return null;
        }

        const versionRows = db
          .prepare(
            `SELECT version FROM version_history WHERE winget_id = ? ORDER BY created_at DESC`
          )
          .all(wingetId) as { version: string }[];
        const versions = versionRows.map((v) => v.version);

        // tags are stored as a JSON string; restore the array to match the
        // Supabase row shape (CuratedAppFullRow.tags is string[] | null).
        const tags = parseTags((app.tags as string | null) ?? null);
        const isLocaleVariant = Boolean(app.is_locale_variant);

        let localeVariants: LocaleVariant[] | undefined;
        if (!isLocaleVariant) {
          const variantRows = db
            .prepare(
              `SELECT winget_id, locale_code, latest_version
               FROM curated_apps
               WHERE parent_winget_id = ?`
            )
            .all(wingetId) as {
            winget_id: string;
            locale_code: string | null;
            latest_version: string | null;
          }[];

          if (variantRows.length > 0) {
            localeVariants = variantRows.map((v) => {
              const display = getLocaleDisplay(v.locale_code || '');
              return {
                wingetId: v.winget_id,
                localeCode: v.locale_code || '',
                localeName: display.name,
                countryFlag: display.flag,
                version: v.latest_version || undefined,
              };
            });
          }
        }

        return {
          app: {
            ...app,
            tags,
            is_locale_variant: isLocaleVariant,
            has_icon: Boolean(app.has_icon),
            is_verified: Boolean(app.is_verified),
          } as unknown as CuratedAppWithDetails['app'],
          versions,
          localeVariants,
        };
      },
      () => null
    );
  }

  async getVersions(wingetId: string): Promise<string[]> {
    return withDb(
      (db) => {
        const rows = db
          .prepare(
            `SELECT version FROM version_history WHERE winget_id = ? ORDER BY created_at DESC`
          )
          .all(wingetId) as { version: string }[];
        return rows.map((v) => v.version);
      },
      () => []
    );
  }

  async getVersionInstallerInfo(
    wingetId: string,
    version: string
  ): Promise<VersionInstallerInfo | null> {
    return withDb(
      (db) => {
        const row = db
          .prepare(
            `SELECT installer_url, installer_sha256, installer_type, installer_scope, installers
             FROM version_history
             WHERE winget_id = ? AND version = ?`
          )
          .get(wingetId, version) as
          | {
              installer_url: string | null;
              installer_sha256: string | null;
              installer_type: string | null;
              installer_scope: string | null;
              installers: string | null;
            }
          | undefined;

        if (!row) return null;
        return {
          installer_url: row.installer_url,
          installer_sha256: row.installer_sha256,
          installer_type: row.installer_type,
          installer_scope: row.installer_scope,
          installers: row.installers ? JSON.parse(row.installers) : null,
        };
      },
      () => null
    );
  }

  async getLatestVersionInstallerInfo(
    wingetId: string,
    version: string
  ): Promise<VersionInstallerInfo | null> {
    return withDb(
      (db) => {
        const row = db
          .prepare(
            `SELECT installer_url, installer_sha256, installer_type, installer_scope, installers
             FROM version_history
             WHERE winget_id = ? AND version = ?
             ORDER BY created_at DESC
             LIMIT 1`
          )
          .get(wingetId, version) as
          | {
              installer_url: string | null;
              installer_sha256: string | null;
              installer_type: string | null;
              installer_scope: string | null;
              installers: string | null;
            }
          | undefined;

        if (!row) return null;
        return {
          installer_url: row.installer_url,
          installer_sha256: row.installer_sha256,
          installer_type: row.installer_type,
          installer_scope: row.installer_scope,
          installers: row.installers ? JSON.parse(row.installers) : null,
        };
      },
      () => null
    );
  }

  async getInstallationChangelog(
    _wingetId: string,
    _version?: string
  ): Promise<InstallationSnapshot | null> {
    // installation_snapshots is operational data, not catalog data, so it is
    // not shipped in the snapshot. There is nothing to return in sqlite mode.
    return null;
  }

  // ---------------------------------------------------------------------------
  // update detection
  // ---------------------------------------------------------------------------

  async getAppsByWingetIds(ids: string[]): Promise<WingetIdLatestVersion[]> {
    return withDb(
      (db) => {
        if (ids.length === 0) return [];
        const placeholders = ids.map(() => '?').join(', ');
        const rows = db
          .prepare(
            `SELECT winget_id, latest_version FROM curated_apps WHERE winget_id IN (${placeholders})`
          )
          .all(...ids) as WingetIdLatestVersion[];
        return rows;
      },
      () => []
    );
  }

  async getAllLatestVersions(): Promise<WingetIdLatestVersion[]> {
    return withDb(
      (db) => {
        const rows = db
          .prepare(
            `SELECT winget_id, latest_version FROM curated_apps WHERE latest_version IS NOT NULL`
          )
          .all() as WingetIdLatestVersion[];
        return rows;
      },
      () => []
    );
  }

  // ---------------------------------------------------------------------------
  // small metadata lookups
  // ---------------------------------------------------------------------------

  async getAppNamePublisher(
    wingetId: string
  ): Promise<{ name: string; publisher: string | null } | null> {
    return withDb(
      (db) => {
        const row = db
          .prepare(`SELECT name, publisher FROM curated_apps WHERE winget_id = ?`)
          .get(wingetId) as { name: string; publisher: string | null } | undefined;
        return row ?? null;
      },
      () => null
    );
  }

  async getAppForInstaller(wingetId: string): Promise<{
    winget_id: string;
    name: string;
    latest_version: string | null;
  } | null> {
    return withDb(
      (db) => {
        const row = db
          .prepare(
            `SELECT winget_id, name, latest_version FROM curated_apps WHERE winget_id = ?`
          )
          .get(wingetId) as
          | { winget_id: string; name: string; latest_version: string | null }
          | undefined;
        return row ?? null;
      },
      () => null
    );
  }

  async getSccmCuratedApp(wingetId: string): Promise<SccmCuratedAppRow | null> {
    return withDb(
      (db) => {
        const row = db
          .prepare(
            `SELECT winget_id, name, publisher, latest_version, description, homepage, license, tags, category, icon_path
             FROM curated_apps WHERE winget_id = ?`
          )
          .get(wingetId) as
          | (Omit<SccmCuratedAppRow, 'tags'> & { tags: string | null })
          | undefined;

        if (!row) return null;
        return { ...row, tags: parseTags(row.tags) };
      },
      () => null
    );
  }

  async getAppDescription(wingetId: string): Promise<string | undefined> {
    return withDb(
      (db) => {
        const row = db
          .prepare(`SELECT description FROM curated_apps WHERE winget_id = ? LIMIT 1`)
          .get(wingetId) as { description: string | null } | undefined;
        if (!row?.description || typeof row.description !== 'string') {
          return undefined;
        }
        return row.description;
      },
      () => undefined
    );
  }

  // ---------------------------------------------------------------------------
  // matching
  // ---------------------------------------------------------------------------

  async searchCuratedAppsForMatching(term: string): Promise<CuratedAppMatch[]> {
    if (!term || term.length < 2) {
      return [];
    }
    const normalizedSearch = term.toLowerCase().trim();

    return withDb(
      (db) => {
        const rows = db
          .prepare(
            `SELECT winget_id, name, publisher, latest_version
             FROM curated_apps
             WHERE latest_version IS NOT NULL
               AND (
                 lower(name) LIKE '%' || @term || '%'
                 OR lower(publisher) LIKE '%' || @term || '%'
                 OR lower(winget_id) LIKE '%' || @term || '%'
               )
             ORDER BY popularity_rank IS NULL, popularity_rank ASC
             LIMIT 10`
          )
          .all({ term: normalizedSearch }) as {
          winget_id: string;
          name: string;
          publisher: string;
          latest_version: string | null;
        }[];

        return rows.map((app) => ({
          wingetId: app.winget_id,
          name: app.name,
          publisher: app.publisher,
          latestVersion: app.latest_version,
        }));
      },
      () => []
    );
  }

  async getSccmMapping(
    query: SccmMappingQuery,
    _tenantId: string
  ): Promise<SccmMappingResult | null> {
    return withDb(
      (db) => {
        const { displayNameNormalized, ciId, productCode } = query;

        const conditions = [
          'sccm_display_name_normalized = @displayNameNormalized',
          'sccm_ci_id = @ciId',
        ];
        const params: Record<string, unknown> = { displayNameNormalized, ciId };
        if (productCode) {
          conditions.push('sccm_product_code = @productCode');
          params.productCode = productCode;
        }

        const mapping = db
          .prepare(
            `SELECT id, winget_package_id, winget_package_name, confidence, is_verified, sccm_product_code
             FROM sccm_winget_mappings
             WHERE ${conditions.join(' OR ')}
             ORDER BY is_verified DESC
             LIMIT 1`
          )
          .get(params) as
          | {
              id: string;
              winget_package_id: string | null;
              winget_package_name: string | null;
              confidence: number | null;
              is_verified: number | null;
              sccm_product_code: string | null;
            }
          | undefined;

        // The snapshot only ships global mappings (no tenant_id column), so
        // there is no tenant-scope rejection to perform here.
        if (!mapping) return null;

        const wingetId = mapping.winget_package_id;
        if (!wingetId) return null;

        return {
          status: 'matched',
          wingetId,
          wingetName: mapping.winget_package_name || wingetId.split('.').pop() || wingetId,
          confidence: mapping.confidence ?? 1.0,
          partialMatches: [],
          matchedBy: mapping.sccm_product_code && productCode ? 'product_code' : 'mapping',
          mappingId: mapping.id,
        };
      },
      () => null
    );
  }

  // ---------------------------------------------------------------------------
  // existence checks
  // ---------------------------------------------------------------------------

  async appExists(wingetId: string): Promise<boolean> {
    return withDb(
      (db) => {
        const row = db
          .prepare(`SELECT id, winget_id FROM curated_apps WHERE winget_id = ?`)
          .get(wingetId);
        return Boolean(row);
      },
      () => false
    );
  }

  async appExistsCaseInsensitive(
    wingetId: string
  ): Promise<{ winget_id: string } | null> {
    return withDb(
      (db) => {
        const row = db
          .prepare(
            `SELECT id, winget_id FROM curated_apps WHERE winget_id = ? COLLATE NOCASE LIMIT 1`
          )
          .get(wingetId) as { winget_id: string } | undefined;
        return row ? { winget_id: row.winget_id } : null;
      },
      () => null
    );
  }

  async findSimilarVerifiedApps(
    term: string,
    limit: number
  ): Promise<{ winget_id: string; name: string }[]> {
    return withDb(
      (db) => {
        const rows = db
          .prepare(
            `SELECT winget_id, name
             FROM curated_apps
             WHERE is_verified = 1
               AND (winget_id LIKE '%' || @term || '%' OR name LIKE '%' || @term || '%')
             LIMIT @limit`
          )
          .all({ term, limit }) as { winget_id: string; name: string }[];
        return rows;
      },
      () => []
    );
  }

  // ---------------------------------------------------------------------------
  // stats
  // ---------------------------------------------------------------------------

  async getCatalogStats(): Promise<{ totalApps: number }> {
    return withDb(
      (db) => {
        const row = db
          .prepare(`SELECT COUNT(*) AS c FROM curated_apps`)
          .get() as { c: number };
        return { totalApps: row.c ?? 0 };
      },
      () => ({ totalApps: 0 })
    );
  }
}
