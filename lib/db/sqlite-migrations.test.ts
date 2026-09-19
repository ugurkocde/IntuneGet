import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS, getSqliteSchemaVersion, runSqliteMigrations } from './sqlite-migrations';

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function tableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
    (row) => row.name
  );
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name);
}

describe('sqlite migrations', () => {
  it('creates every table and records the latest version on a fresh database', () => {
    const db = new Database(':memory:');
    runSqliteMigrations(db);

    expect(getSqliteSchemaVersion(db)).toBe(LATEST_VERSION);
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        'packaging_jobs',
        'upload_history',
        'app_update_policies',
        'auto_update_history',
        'update_check_results',
      ])
    );
    db.close();
  });

  it('is idempotent across repeated runs', () => {
    const db = new Database(':memory:');
    runSqliteMigrations(db);
    runSqliteMigrations(db);
    expect(getSqliteSchemaVersion(db)).toBe(LATEST_VERSION);
    expect(tableNames(db).filter((name) => name === 'app_update_policies')).toHaveLength(1);
    db.close();
  });

  it('upgrades a database that predates the runner', () => {
    const db = new Database(':memory:');
    // A self-hosted database created before migrations: no version, and
    // packaging_jobs missing the later columns.
    db.exec(`
      CREATE TABLE packaging_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        winget_id TEXT NOT NULL,
        status TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        packager_heartbeat_at TEXT
      );
      CREATE TABLE upload_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        deployed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    runSqliteMigrations(db);

    const columns = columnNames(db, 'packaging_jobs');
    expect(columns).toEqual(expect.arrayContaining(['archived_at', 'is_auto_update', 'auto_update_policy_id']));
    expect(getSqliteSchemaVersion(db)).toBe(LATEST_VERSION);
    expect(tableNames(db)).toEqual(expect.arrayContaining(['app_update_policies', 'auto_update_history']));
    db.close();
  });
});
