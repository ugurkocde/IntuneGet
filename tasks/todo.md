# Catalog snapshot for self-hosted (Supabase-less) mode

## Goal
Let self-hosters running `DATABASE_MODE=sqlite` with **no Supabase** use the full catalog
(browse/search + deploy + update detection + SCCM) by downloading a periodically published
**SQLite snapshot** of the catalog tables from a **GitHub Release**. No new public API.

Context: catalog = `curated_apps`, `version_history`, `sccm_winget_mappings` (+ `app_metadata`,
`curated_excluded_apps` if needed). Today ~14 read sites hit Supabase directly (incl. RPCs
`search_curated_apps`, `get_popular_curated_apps`, `get_curated_categories`,
`get_locale_variants`, `get_installation_changelog`); the `/api/winget/*` routes already 503
without Supabase, the rest throw. SQLite adapter exists at `lib/db/sqlite.ts` (better-sqlite3,
`DATABASE_PATH`, default `./data/intuneget.db`). The `sync-packages` cron WRITES the catalog and
stays Supabase-only.

## Design
- `lib/catalog/types.ts` — `CatalogSource` interface (the ~14 ops below).
- `lib/catalog/supabase-source.ts` — wraps the existing Supabase reads/RPCs (no behavior change).
- `lib/catalog/snapshot-source.ts` — better-sqlite3 queries over the downloaded snapshot; FTS5 for search.
- `lib/catalog/index.ts` — `getCatalogSource()`, selects Supabase when `isSupabaseConfigured()` else snapshot.
- Reroute all reader sites through `getCatalogSource()`.

### CatalogSource operations (from the read-surface audit)
- searchApps(query, { limit, offset, category, sort }) — replicates `search_curated_apps` (FTS + CASE order + ILIKE fallback, filters is_verified/is_locale_variant/category)
- getPopularApps({ limit, offset, category, sort }) + count
- getCategories() -> [{ category, count }]
- getAppByWingetId(wingetId) (+ locale variants, versions)
- getVersions(wingetId) -> string[]
- getLatestVersion(wingetId) -> string | null
- getVersionInstallerInfo(wingetId, version) -> { url, sha256, type, scope, installers? }
- getAppsByWingetIds(ids[]) -> [{ winget_id, latest_version }]  (batch update detection)
- getAppMetaForVersionHistory(wingetId) -> { name, latest_version }
- searchCuratedAppsForMatching(term) -> [{ wingetId, name, publisher, latestVersion }]
- getSccmMappings({ displayNameNormalized, ciId, productCode }) -> mapping | null
- appExists(wingetId) -> boolean
- getInstallationChangelog(wingetId, version)
- getCatalogStats() -> { totalApps }

## Snapshot generation (CI / build side)
- `scripts/build-catalog-snapshot.mjs`: read catalog tables from Supabase (service role) -> write
  `catalog.sqlite` (schema + indexes + FTS5 over name/publisher/description/tags), gzip, sha256,
  emit `manifest.json` { schemaVersion, version, generatedAt, sha256, sizeBytes }.
- GitHub Actions: after the daily catalog sync, run the script and publish `catalog.sqlite.gz` +
  `manifest.json` as assets on a rolling `catalog-latest` Release (overwrite assets each run).
- ONLY catalog tables included — assert no user/tenant tables present.

## Snapshot consumption (runtime / self-host)
- `lib/catalog/snapshot-store.ts`: on first use (sqlite mode), GET the release `manifest.json`;
  if local snapshot missing or version/sha differs, download `.gz`, verify sha256, decompress to
  `<data dir>/catalog.sqlite`, open read-only (better-sqlite3). Re-check manifest on an interval
  (daily) and hot-swap. Download/verify failure: keep serving the last good snapshot; if none,
  return a clear 503 with guidance (not a crash).
- Self-hosters in sqlite mode run a persistent container, so local disk + better-sqlite3 is valid
  (not serverless).

## Phasing (ship incrementally)
- [x] Phase 1 — Abstraction + SupabaseCatalogSource. DONE (PR pending). `lib/catalog/{types,supabase-source,index}.ts`
      created; 17 read sites rerouted. Verified: tsc clean, next lint clean, 408/408 vitest, grep shows no
      direct catalog access outside lib/catalog + sync-packages, and a separate code-review found 0 behavior
      regressions (the #133 SCCM mapping fix preserved). Manifest/GitHub fallbacks untouched.
- [x] Phase 2 — Snapshot generation + CI + Release. DONE. `scripts/build-catalog-snapshot.mjs`
      (better-sqlite3 + FTS5, `--self-test` passes) + a `snapshot` job appended to `sync-manifests.yml`
      (daily, after sync) publishing `catalog.sqlite.gz` + `manifest.json` to a rolling `catalog-latest`
      prerelease. Excludes assets/PII: fts tsvector, icon/curation bookkeeping, version_history.manifest_yaml
      /release_notes, and sccm created_by/tenant_id (global mappings only). Download URL base:
      `https://github.com/ugurkocde/IntuneGet/releases/download/catalog-latest/`.
- [x] Phase 3 — SnapshotCatalogSource + download/refresh store + selector. DONE.
      `lib/catalog/snapshot-store.ts` (https-only, sha256-verify-before-unpack, compressed + decompressed
      size caps, read-only/query_only, atomic swap, lazy better-sqlite3, CATALOG_SNAPSHOT_FILE override),
      `lib/catalog/snapshot-source.ts` (22 methods, FTS5 + ILIKE fallback). `getCatalogSource()` lazy-loads
      the snapshot source when `!isSupabaseConfigured()`. Removed `runtime='edge'` from the 7 winget routes.
      Verified: tsc clean, lint clean, 424/424 vitest (16 new catalog tests), no static native imports reach
      edge/Supabase bundles, and a security review (atomic-swap race + zip-bomb/size caps fixed; remaining
      Lows accepted).

## Acceptance criteria
- [ ] Supabase mode: every catalog route returns behavior identical to today (regression-free).
- [ ] sqlite mode + no Supabase, after snapshot download: search/popular/categories work; app
      detail/versions/installer-info resolve; update detection (`check-updates`, `intune/apps/updates`)
      finds latest versions; SCCM migrate + matching resolve curated data; community endpoints
      validate app existence.
- [ ] Snapshot integrity: sha256 verified before use; corrupt/failed download never crashes the app.
- [ ] Snapshot contains catalog tables only (no user/tenant/consent data) — asserted in the build.
- [ ] Freshness: a CI run publishes a new snapshot on the catalog-sync schedule; self-host adopts it
      within its refresh interval.
- [ ] Search parity: SnapshotCatalogSource ordering matches `search_curated_apps` on a fixture set
      (exact > prefix > rank/popularity; ILIKE fallback when FTS empty).
- [ ] Tests: backend selector picks correct source; snapshot search ordering test; build script smoke test.

## Open questions / confirm before Phase 1
- Phase 1 alone (safe refactor) shippable as its own PR? (recommended)
- Release naming: rolling `catalog-latest` with overwritten assets (recommended) vs dated releases.
- Acceptable search fidelity: FTS5 (close to Postgres FTS) vs LIKE-only v1.

## Review
(to be filled after implementation)
