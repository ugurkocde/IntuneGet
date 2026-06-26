/**
 * Build the self-hosted app-catalog snapshot.
 *
 * Exports the PUBLIC catalog tables (curated_apps, version_history, and the
 * GLOBAL sccm_winget_mappings) from Supabase into a single SQLite file with
 * indexes + an FTS5 search table, gzips it, and emits a manifest.json with a
 * sha256 for integrity. Self-hosted instances in sqlite mode download this
 * instead of running their own Supabase (see Phase 3 / SnapshotCatalogSource).
 *
 * Deliberately EXCLUDED from the snapshot:
 *  - Internal/curation + icon bookkeeping columns, and the Postgres `fts`
 *    tsvector (FTS5 is rebuilt locally).
 *  - version_history.manifest_yaml / release_notes / changes_from_previous
 *    (large "asset" text never read by the catalog code).
 *  - sccm_winget_mappings.created_by / tenant_id and any tenant-scoped rows -
 *    only global mappings (tenant_id IS NULL) are included, so no user/tenant
 *    data ever lands in a public snapshot.
 *
 * Usage:
 *   node scripts/build-catalog-snapshot.mjs            # export from Supabase
 *   node scripts/build-catalog-snapshot.mjs --self-test # build from mock rows + verify
 *
 * Env (export mode): SUPABASE_URL, SUPABASE_SERVICE_KEY, SNAPSHOT_OUT_DIR (default ./snapshot)
 */

import { createClient } from '@supabase/supabase-js';
import Database from 'better-sqlite3';
import { createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

const CURATED_COLUMNS = [
  'id', 'winget_id', 'name', 'publisher', 'latest_version', 'description',
  'homepage', 'license', 'popularity_rank', 'category', 'subcategory', 'tags',
  'icon_path', 'has_icon', 'is_verified', 'is_locale_variant',
  'parent_winget_id', 'locale_code', 'app_source', 'store_package_id', 'created_at',
];
const VERSION_COLUMNS = [
  'winget_id', 'version', 'installer_url', 'installer_sha256', 'installer_type',
  'installer_scope', 'silent_args', 'installers', 'created_at',
];
const SCCM_COLUMNS = [
  'id', 'sccm_display_name_normalized', 'sccm_ci_id', 'sccm_product_code',
  'winget_package_id', 'winget_package_name', 'confidence', 'is_verified',
];

/** Fetch every row of a table in pages (Supabase caps a single request at 1000). */
async function fetchAll(supabase, table, columns, applyFilter) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(columns.join(',')).range(from, from + pageSize - 1);
    if (applyFilter) query = applyFilter(query);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

const bool = (v) => (v ? 1 : 0);
const jsonOrNull = (v) => (v == null ? null : JSON.stringify(v));

/**
 * Build the SQLite snapshot file at dbPath from in-memory rows. Pure and
 * deterministic given the inputs, so the self-test can exercise it offline.
 */
export function buildSqlite(dbPath, { curatedApps, versionHistory, sccmMappings }) {
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = DELETE');
    db.exec(`
      CREATE TABLE curated_apps (
        id INTEGER PRIMARY KEY, winget_id TEXT, name TEXT, publisher TEXT,
        latest_version TEXT, description TEXT, homepage TEXT, license TEXT,
        popularity_rank INTEGER, category TEXT, subcategory TEXT, tags TEXT,
        icon_path TEXT, has_icon INTEGER, is_verified INTEGER, is_locale_variant INTEGER,
        parent_winget_id TEXT, locale_code TEXT, app_source TEXT, store_package_id TEXT,
        created_at TEXT
      );
      CREATE INDEX idx_curated_winget ON curated_apps(winget_id);
      CREATE INDEX idx_curated_winget_nocase ON curated_apps(winget_id COLLATE NOCASE);
      CREATE INDEX idx_curated_popular ON curated_apps(is_verified, is_locale_variant, popularity_rank);
      CREATE INDEX idx_curated_category ON curated_apps(category);

      CREATE VIRTUAL TABLE curated_fts USING fts5(name, publisher, description, tags);

      CREATE TABLE version_history (
        winget_id TEXT, version TEXT, installer_url TEXT, installer_sha256 TEXT,
        installer_type TEXT, installer_scope TEXT, silent_args TEXT, installers TEXT,
        created_at TEXT, PRIMARY KEY (winget_id, version)
      );
      CREATE INDEX idx_vh_winget ON version_history(winget_id);

      CREATE TABLE sccm_winget_mappings (
        id TEXT PRIMARY KEY, sccm_display_name_normalized TEXT, sccm_ci_id TEXT,
        sccm_product_code TEXT, winget_package_id TEXT, winget_package_name TEXT,
        confidence REAL, is_verified INTEGER
      );
      CREATE INDEX idx_sccm_name ON sccm_winget_mappings(sccm_display_name_normalized);
      CREATE INDEX idx_sccm_ci ON sccm_winget_mappings(sccm_ci_id);
    `);

    const insCurated = db.prepare(`INSERT INTO curated_apps
      (id, winget_id, name, publisher, latest_version, description, homepage, license,
       popularity_rank, category, subcategory, tags, icon_path, has_icon, is_verified,
       is_locale_variant, parent_winget_id, locale_code, app_source, store_package_id, created_at)
      VALUES (@id,@winget_id,@name,@publisher,@latest_version,@description,@homepage,@license,
       @popularity_rank,@category,@subcategory,@tags,@icon_path,@has_icon,@is_verified,
       @is_locale_variant,@parent_winget_id,@locale_code,@app_source,@store_package_id,@created_at)`);
    // Standalone FTS5 table; rowid mirrors curated_apps.id so search joins back.
    const insFts = db.prepare(`INSERT INTO curated_fts (rowid, name, publisher, description, tags)
      VALUES (@id, @name, @publisher, @description, @tags)`);
    const insVersion = db.prepare(`INSERT OR IGNORE INTO version_history
      (winget_id, version, installer_url, installer_sha256, installer_type, installer_scope,
       silent_args, installers, created_at)
      VALUES (@winget_id,@version,@installer_url,@installer_sha256,@installer_type,@installer_scope,
       @silent_args,@installers,@created_at)`);
    const insSccm = db.prepare(`INSERT OR IGNORE INTO sccm_winget_mappings
      (id, sccm_display_name_normalized, sccm_ci_id, sccm_product_code, winget_package_id,
       winget_package_name, confidence, is_verified)
      VALUES (@id,@sccm_display_name_normalized,@sccm_ci_id,@sccm_product_code,@winget_package_id,
       @winget_package_name,@confidence,@is_verified)`);

    const tx = db.transaction(() => {
      for (const a of curatedApps) {
        const tags = a.tags ? JSON.stringify(a.tags) : null;
        insCurated.run({
          id: a.id, winget_id: a.winget_id, name: a.name, publisher: a.publisher,
          latest_version: a.latest_version ?? null, description: a.description ?? null,
          homepage: a.homepage ?? null, license: a.license ?? null,
          popularity_rank: a.popularity_rank ?? null, category: a.category ?? null,
          subcategory: a.subcategory ?? null, tags, icon_path: a.icon_path ?? null,
          has_icon: bool(a.has_icon), is_verified: bool(a.is_verified),
          is_locale_variant: bool(a.is_locale_variant), parent_winget_id: a.parent_winget_id ?? null,
          locale_code: a.locale_code ?? null, app_source: a.app_source ?? null,
          store_package_id: a.store_package_id ?? null, created_at: a.created_at ?? null,
        });
        insFts.run({
          id: a.id, name: a.name ?? '', publisher: a.publisher ?? '',
          description: a.description ?? '', tags: Array.isArray(a.tags) ? a.tags.join(' ') : '',
        });
      }
      for (const v of versionHistory) {
        insVersion.run({
          winget_id: v.winget_id, version: v.version, installer_url: v.installer_url ?? null,
          installer_sha256: v.installer_sha256 ?? null, installer_type: v.installer_type ?? null,
          installer_scope: v.installer_scope ?? null, silent_args: v.silent_args ?? null,
          installers: jsonOrNull(v.installers), created_at: v.created_at ?? null,
        });
      }
      for (const m of sccmMappings) {
        insSccm.run({
          id: m.id, sccm_display_name_normalized: m.sccm_display_name_normalized ?? null,
          sccm_ci_id: m.sccm_ci_id ?? null, sccm_product_code: m.sccm_product_code ?? null,
          winget_package_id: m.winget_package_id ?? null, winget_package_name: m.winget_package_name ?? null,
          confidence: m.confidence ?? null, is_verified: bool(m.is_verified),
        });
      }
    });
    tx();

    db.exec("INSERT INTO curated_fts(curated_fts) VALUES('optimize');");
    db.pragma('wal_checkpoint(TRUNCATE)');
    return {
      curated_apps: curatedApps.length,
      version_history: versionHistory.length,
      sccm_winget_mappings: sccmMappings.length,
    };
  } finally {
    db.close();
  }
}

async function gzipFile(src, dest) {
  await pipeline(createReadStream(src), createGzip({ level: 9 }), createWriteStream(dest));
}

async function sha256File(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function exportFromSupabase(outDir) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');

  const supabase = createClient(url, key);
  console.log('Reading catalog from Supabase...');
  const [curatedApps, versionHistory, sccmMappings] = await Promise.all([
    fetchAll(supabase, 'curated_apps', CURATED_COLUMNS),
    fetchAll(supabase, 'version_history', VERSION_COLUMNS),
    // Only GLOBAL mappings (no tenant data) reach a public snapshot.
    fetchAll(supabase, 'sccm_winget_mappings', SCCM_COLUMNS, (q) => q.is('tenant_id', null)),
  ]);
  console.log(`  curated_apps: ${curatedApps.length}`);
  console.log(`  version_history: ${versionHistory.length}`);
  console.log(`  sccm_winget_mappings (global): ${sccmMappings.length}`);

  return writeSnapshot(outDir, { curatedApps, versionHistory, sccmMappings });
}

async function writeSnapshot(outDir, rows, generatedAt = new Date().toISOString()) {
  await mkdir(outDir, { recursive: true });
  const dbPath = path.join(outDir, 'catalog.sqlite');
  const gzPath = path.join(outDir, 'catalog.sqlite.gz');
  const manifestPath = path.join(outDir, 'manifest.json');
  await rm(dbPath, { force: true });
  await rm(gzPath, { force: true });

  const counts = buildSqlite(dbPath, rows);
  await gzipFile(dbPath, gzPath);
  const sha256 = await sha256File(gzPath);
  const gzSize = (await stat(gzPath)).size;
  const rawSize = (await stat(dbPath)).size;

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    version: generatedAt,
    generatedAt,
    sha256,
    sizeBytes: gzSize,
    uncompressedBytes: rawSize,
    counts,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Snapshot: ${(gzSize / 1e6).toFixed(1)}MB gz (${(rawSize / 1e6).toFixed(1)}MB raw), sha256 ${sha256.slice(0, 12)}...`);
  return { manifest, dbPath, gzPath, manifestPath };
}

async function selfTest() {
  const os = await import('node:os');
  const outDir = path.join(os.tmpdir(), `catalog-snapshot-selftest-${process.pid}`);
  const curatedApps = [
    { id: 1, winget_id: 'Google.Chrome', name: 'Google Chrome', publisher: 'Google LLC', latest_version: '120.0', description: 'Fast web browser', homepage: 'https://google.com', tags: ['browser', 'web'], category: 'Browsers', is_verified: true, is_locale_variant: false, popularity_rank: 1, app_source: 'winget', has_icon: true },
    { id: 2, winget_id: 'Mozilla.Firefox', name: 'Mozilla Firefox', publisher: 'Mozilla', latest_version: '121.0', description: 'Open source browser', tags: ['browser'], category: 'Browsers', is_verified: true, is_locale_variant: false, popularity_rank: 2 },
    { id: 3, winget_id: 'Zoom.Zoom', name: 'Zoom Workplace', publisher: 'Zoom', latest_version: '6.0', tags: null, category: 'Communication', is_verified: true, is_locale_variant: false, popularity_rank: 5 },
  ];
  const versionHistory = [
    { winget_id: 'Google.Chrome', version: '120.0', installer_url: 'https://x/chrome.msi', installer_sha256: 'abc', installer_type: 'msi', installers: [{ Architecture: 'x64', InstallerUrl: 'https://x/chrome.msi' }], created_at: '2026-01-01T00:00:00Z' },
  ];
  const sccmMappings = [
    { id: 'm1', sccm_display_name_normalized: 'google chrome', sccm_ci_id: '123', sccm_product_code: null, winget_package_id: 'Google.Chrome', winget_package_name: 'Google Chrome', confidence: 1, is_verified: true },
  ];

  const { dbPath, manifest } = await writeSnapshot(outDir, { curatedApps, versionHistory, sccmMappings });

  const db = new Database(dbPath, { readonly: true });
  const assert = (cond, msg) => { if (!cond) throw new Error(`SELF-TEST FAIL: ${msg}`); };

  // FTS search for "chrome" should hit the Chrome row
  const ftsHit = db.prepare(
    `SELECT ca.winget_id FROM curated_fts f JOIN curated_apps ca ON ca.id = f.rowid WHERE curated_fts MATCH ? LIMIT 5`
  ).all('chrome');
  assert(ftsHit.some((r) => r.winget_id === 'Google.Chrome'), 'FTS search for "chrome" found Chrome');

  // popularity ordering for verified non-variant apps
  const popular = db.prepare(
    `SELECT winget_id FROM curated_apps WHERE is_verified=1 AND is_locale_variant=0 ORDER BY popularity_rank ASC LIMIT 3`
  ).all();
  assert(popular[0].winget_id === 'Google.Chrome', 'popular ordering by popularity_rank');

  // tags round-trip as JSON
  const chrome = db.prepare(`SELECT tags FROM curated_apps WHERE winget_id=?`).get('Google.Chrome');
  assert(JSON.stringify(JSON.parse(chrome.tags)) === JSON.stringify(['browser', 'web']), 'tags JSON round-trip');

  // installer info + installers JSON
  const vh = db.prepare(`SELECT installer_url, installers FROM version_history WHERE winget_id=? AND version=?`).get('Google.Chrome', '120.0');
  assert(vh.installer_url === 'https://x/chrome.msi', 'installer_url present');
  assert(JSON.parse(vh.installers)[0].Architecture === 'x64', 'installers JSON round-trip');

  // sccm mapping snake_case columns present
  const sccm = db.prepare(`SELECT winget_package_id FROM sccm_winget_mappings WHERE sccm_display_name_normalized=?`).get('google chrome');
  assert(sccm.winget_package_id === 'Google.Chrome', 'sccm mapping lookup');

  // no excluded/PII columns leaked
  const sccmCols = db.prepare(`PRAGMA table_info(sccm_winget_mappings)`).all().map((c) => c.name);
  assert(!sccmCols.includes('created_by') && !sccmCols.includes('tenant_id'), 'no created_by/tenant_id in sccm table');
  const caCols = db.prepare(`PRAGMA table_info(curated_apps)`).all().map((c) => c.name);
  assert(!caCols.includes('fts'), 'no fts column in curated_apps');

  db.close();
  await rm(outDir, { recursive: true, force: true });
  console.log('SELF-TEST PASSED. manifest:', JSON.stringify(manifest.counts));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const outDir = process.env.SNAPSHOT_OUT_DIR || './snapshot';
  const run = process.argv.includes('--self-test') ? selfTest() : exportFromSupabase(outDir).then(({ manifest }) => {
    console.log('Done. Manifest:', JSON.stringify(manifest));
  });
  run.catch((err) => { console.error(err); process.exit(1); });
}
