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
  it('adds tenant mappings after version six without changing saved definitions', () => {
    const db = new Database(':memory:');
    for (const migration of MIGRATIONS.filter(migration => migration.version <= 6)) migration.up(db);
    db.pragma('user_version = 6');
    db.prepare('INSERT INTO custom_app_definitions (id, user_id, tenant_id, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('saved-fixture', 'user', 'tenant', '{"displayName":"Saved fixture"}', 'fixture', 'fixture');
    runSqliteMigrations(db);
    expect(getSqliteSchemaVersion(db)).toBe(7);
    expect(db.prepare('SELECT definition FROM custom_app_definitions WHERE id = ?').get('saved-fixture')).toEqual({ definition: '{"displayName":"Saved fixture"}' });
    const insert = db.prepare('INSERT INTO manual_app_mappings (id, tenant_id, created_by, discovered_app_name, winget_package_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run('mapping-one', 'tenant', 'user', 'fixture', 'Fixture.App', 'fixture', 'fixture');
    expect(() => insert.run('mapping-two', 'tenant', 'user', 'fixture', 'Fixture.App', 'fixture', 'fixture')).toThrow(/UNIQUE/);
    insert.run('mapping-three', 'other-tenant', 'user', 'fixture', 'Fixture.App', 'fixture', 'fixture');
    db.close();
  });
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
        'curated_licence_attestations',
        'claimed_apps',
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


it('upgrades existing policies to all updates and constrains scope values', () => {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS.filter(m => m.version < 8)) migration.up(db);
  db.pragma('user_version = 6');
  db.exec("INSERT INTO app_update_policies (id,user_id,tenant_id,winget_id,policy_type) VALUES ('p','u','t','App.Test','notify')");
  runSqliteMigrations(db);
  expect(db.prepare('SELECT auto_update_scope FROM app_update_policies').get()).toEqual({ auto_update_scope: 'all' });
  expect(() => db.exec("UPDATE app_update_policies SET auto_update_scope = 'unknown'")).toThrow();
  db.close();
});
