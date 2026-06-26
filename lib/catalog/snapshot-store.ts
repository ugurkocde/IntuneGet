/**
 * Catalog snapshot store (self-hosted / Supabase-less mode).
 *
 * Downloads the published catalog SQLite snapshot from the GitHub `catalog-latest`
 * release, verifies it, and hands SnapshotCatalogSource a read-only handle.
 *
 * Security posture:
 *  - The download URL must be HTTPS (a non-https override is rejected).
 *  - The gzip is size-capped while streaming to bound disk use.
 *  - The gzip's sha256 is verified against the manifest BEFORE it is unpacked
 *    or opened, so a corrupted/tampered asset is never used.
 *  - The decompressed DB is validated (opens, expected tables) in a temp file,
 *    then atomically renamed into place; the live handle is opened read-only
 *    with query_only enforced.
 *  - better-sqlite3 (an optionalDependency) is lazy-loaded, so nothing here is
 *    pulled into Supabase-mode or edge bundles.
 *
 * A self-hoster can also point CATALOG_SNAPSHOT_FILE at a local .sqlite they
 * trust to skip downloading entirely.
 */

import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';

export const SNAPSHOT_SCHEMA_VERSION = 1;

const DEFAULT_BASE_URL =
  'https://github.com/ugurkocde/IntuneGet/releases/download/catalog-latest';
const MAX_GZ_BYTES = 500 * 1024 * 1024; // hard cap on the downloaded (compressed) asset
const MAX_DECOMPRESSED_BYTES = 1024 * 1024 * 1024; // hard cap on the unpacked DB (zip-bomb guard)
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-check the manifest every 6h
const REQUIRED_TABLES = ['curated_apps', 'curated_fts', 'version_history', 'sccm_winget_mappings'];

type DB = BetterSqlite3.Database;

interface SnapshotManifest {
  schemaVersion: number;
  version: string;
  generatedAt: string;
  sha256: string;
  sizeBytes: number;
  counts?: Record<string, number>;
}

export class SnapshotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotUnavailableError';
  }
}

function baseUrl(): string {
  return (process.env.CATALOG_SNAPSHOT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function snapshotDir(): string {
  if (process.env.CATALOG_SNAPSHOT_DIR) return process.env.CATALOG_SNAPSHOT_DIR;
  const dbPath = process.env.DATABASE_PATH || './data/intuneget.db';
  return path.dirname(dbPath);
}

const dbFilePath = () => path.join(snapshotDir(), 'catalog.sqlite');
const metaFilePath = () => path.join(snapshotDir(), 'catalog.manifest.json');

// Module-level state (one snapshot per process).
let _db: DB | null = null;
let _loadedVersion: string | null = null;
let _lastCheckedAt = 0;
let _inflight: Promise<void> | null = null;
let _DatabaseCtor: typeof BetterSqlite3 | null = null;

async function loadDatabaseCtor(): Promise<typeof BetterSqlite3> {
  if (_DatabaseCtor) return _DatabaseCtor;
  try {
    const mod = await import('better-sqlite3');
    _DatabaseCtor = (mod.default || mod) as typeof BetterSqlite3;
    return _DatabaseCtor;
  } catch {
    throw new SnapshotUnavailableError(
      'The better-sqlite3 package is required to read the catalog snapshot in SQLite mode but is not installed.'
    );
  }
}

function openReadOnly(Database: typeof BetterSqlite3, file: string): DB {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('query_only = true');
  return db;
}

function assertTables(db: DB): void {
  const names = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') OR name LIKE 'curated_fts%'")
      .all()
      .map((r) => (r as { name: string }).name)
  );
  for (const t of REQUIRED_TABLES) {
    if (!names.has(t)) {
      throw new SnapshotUnavailableError(`Catalog snapshot is missing the "${t}" table`);
    }
  }
}

async function fetchManifest(): Promise<SnapshotManifest | null> {
  const url = `${baseUrl()}/manifest.json`;
  if (!url.startsWith('https://')) {
    throw new SnapshotUnavailableError('CATALOG_SNAPSHOT_BASE_URL must be an https URL');
  }
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new SnapshotUnavailableError(`Failed to fetch catalog manifest (HTTP ${res.status})`);
  }
  const manifest = (await res.json()) as SnapshotManifest;
  if (manifest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotUnavailableError(
      `Catalog snapshot schemaVersion ${manifest.schemaVersion} is not supported by this build (expected ${SNAPSHOT_SCHEMA_VERSION}). Update the app.`
    );
  }
  if (!manifest.version || !/^[a-f0-9]{64}$/i.test(manifest.sha256 || '')) {
    throw new SnapshotUnavailableError('Catalog manifest is missing a version or a valid sha256');
  }
  return manifest;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * A Transform that aborts the pipeline once `maxBytes` have passed through,
 * without forwarding the over-limit chunk. Used to bound both the compressed
 * download and the decompressed output before they reach disk.
 */
function byteCap(maxBytes: number, message: string): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) {
        cb(new SnapshotUnavailableError(message));
      } else {
        cb(null, chunk);
      }
    },
  });
}

async function downloadGz(dest: string): Promise<void> {
  const url = `${baseUrl()}/catalog.sqlite.gz`;
  if (!url.startsWith('https://')) {
    throw new SnapshotUnavailableError('CATALOG_SNAPSHOT_BASE_URL must be an https URL');
  }
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) {
    throw new SnapshotUnavailableError(`Failed to download catalog snapshot (HTTP ${res.status})`);
  }
  const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  // Cap before the WriteStream, so an over-limit asset never fully lands on disk.
  await pipeline(
    source,
    byteCap(MAX_GZ_BYTES, 'Catalog snapshot exceeds the maximum allowed download size'),
    createWriteStream(dest)
  );
}

async function downloadVerifyAndSwap(manifest: SnapshotManifest): Promise<void> {
  const Database = await loadDatabaseCtor();
  const dir = snapshotDir();
  await mkdir(dir, { recursive: true });

  const gzTmp = path.join(dir, 'catalog.sqlite.gz.download');
  const dbTmp = path.join(dir, 'catalog.sqlite.tmp');

  try {
    await downloadGz(gzTmp);

    // Verify integrity BEFORE unpacking or opening.
    const actualSha = await sha256File(gzTmp);
    if (actualSha.toLowerCase() !== manifest.sha256.toLowerCase()) {
      throw new SnapshotUnavailableError('Catalog snapshot sha256 does not match the manifest');
    }

    await rm(dbTmp, { force: true });
    // Cap the decompressed output too, so a zip-bomb cannot fill the disk even
    // if it somehow passed the sha256 check.
    await pipeline(
      createReadStream(gzTmp),
      createGunzip(),
      byteCap(MAX_DECOMPRESSED_BYTES, 'Decompressed catalog snapshot exceeds the maximum allowed size'),
      createWriteStream(dbTmp)
    );

    // Validate the decompressed DB opens and has the expected shape.
    const test = openReadOnly(Database, dbTmp);
    try {
      assertTables(test);
    } finally {
      test.close();
    }

    // Swap in: rename first, open the new handle, then atomically repoint _db at
    // it and only then close the old handle. This removes any window where _db
    // is null or where a concurrent reader holds a just-closed handle (queries
    // are synchronous, so once _db points at newDb no query runs on the old one).
    await rename(dbTmp, dbFilePath());
    await writeFile(metaFilePath(), JSON.stringify(manifest));
    const newDb = openReadOnly(Database, dbFilePath());
    const oldDb = _db;
    _db = newDb;
    _loadedVersion = manifest.version;
    oldDb?.close();
  } finally {
    await rm(gzTmp, { force: true }).catch(() => {});
    await rm(dbTmp, { force: true }).catch(() => {});
  }
}

async function openExistingIfPresent(): Promise<boolean> {
  const dbFile = dbFilePath();
  if (!existsSync(dbFile)) return false;
  const Database = await loadDatabaseCtor();
  const db = openReadOnly(Database, dbFile);
  try {
    assertTables(db);
  } catch (err) {
    db.close();
    throw err;
  }
  _db = db;
  try {
    const meta = JSON.parse(await readFile(metaFilePath(), 'utf8')) as SnapshotManifest;
    _loadedVersion = meta.version ?? null;
  } catch {
    _loadedVersion = null;
  }
  return true;
}

async function ensureFresh(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      // Explicit local file wins and skips all networking.
      const localFile = process.env.CATALOG_SNAPSHOT_FILE;
      if (localFile) {
        if (_db) return;
        const Database = await loadDatabaseCtor();
        if (!existsSync(localFile)) {
          throw new SnapshotUnavailableError(`CATALOG_SNAPSHOT_FILE not found: ${localFile}`);
        }
        const db = openReadOnly(Database, localFile);
        assertTables(db);
        _db = db;
        _loadedVersion = 'local-file';
        return;
      }

      let manifest: SnapshotManifest | null = null;
      try {
        manifest = await fetchManifest();
      } catch (err) {
        // Network/manifest failure: keep any DB we already have; otherwise try a
        // previously downloaded file before giving up.
        if (_db) {
          console.error('Catalog snapshot manifest check failed; keeping current snapshot:', err);
          return;
        }
        if (await openExistingIfPresent()) {
          console.error('Catalog snapshot manifest unreachable; using last downloaded snapshot:', err);
          return;
        }
        throw err;
      }

      if (manifest && manifest.version === _loadedVersion && _db) {
        return; // already current
      }
      if (manifest && !_db && (await tryOpenMatchingLocal(manifest))) {
        return; // on-disk file already matches the manifest
      }
      if (manifest) {
        await downloadVerifyAndSwap(manifest);
      }
    } finally {
      _lastCheckedAt = Date.now();
      _inflight = null;
    }
  })();
  return _inflight;
}

async function tryOpenMatchingLocal(manifest: SnapshotManifest): Promise<boolean> {
  try {
    const meta = JSON.parse(await readFile(metaFilePath(), 'utf8')) as SnapshotManifest;
    if (meta.version === manifest.version && existsSync(dbFilePath())) {
      return openExistingIfPresent();
    }
  } catch {
    // no usable local metadata
  }
  return false;
}

/**
 * Return a read-only handle to the catalog snapshot, downloading/refreshing it
 * as needed. The first call blocks until a verified snapshot is open; later
 * calls return the cached handle and refresh in the background on an interval.
 */
export async function getSnapshotDb(): Promise<DB> {
  const now = Date.now();
  if (_db && now - _lastCheckedAt < REFRESH_INTERVAL_MS) {
    return _db;
  }
  if (!_db) {
    await ensureFresh();
  } else {
    _lastCheckedAt = now; // gate background refresh attempts
    void ensureFresh().catch((err) => console.error('Catalog snapshot refresh failed:', err));
  }
  if (!_db) {
    throw new SnapshotUnavailableError('Catalog snapshot is not available');
  }
  return _db;
}

/** Test/diagnostic helper: drop the cached handle and state. */
export function _resetSnapshotStoreForTest(): void {
  if (_db) _db.close();
  _db = null;
  _loadedVersion = null;
  _lastCheckedAt = 0;
  _inflight = null;
}

export async function snapshotMeta(): Promise<{ loadedVersion: string | null; sizeBytes?: number }> {
  const out: { loadedVersion: string | null; sizeBytes?: number } = { loadedVersion: _loadedVersion };
  try {
    out.sizeBytes = (await stat(dbFilePath())).size;
  } catch {
    // ignore
  }
  return out;
}
