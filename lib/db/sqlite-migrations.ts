/**
 * Versioned SQLite migrations.
 *
 * The self-hosted database previously created its schema inline on every start
 * and grew with a hand-maintained column map. That works for additive columns
 * on one table but has no history, no ordering, and no way to add a table or
 * backfill data safely.
 *
 * This runner keeps a schema version in SQLite's built-in `user_version`
 * pragma and applies each migration exactly once, in order, inside a
 * transaction. Existing databases that predate the runner report version 0, so
 * migration 1 reproduces the original baseline idempotently before later
 * migrations run.
 */

import type BetterSqlite3 from 'better-sqlite3';

export interface SqliteMigration {
  version: number;
  name: string;
  up: (db: BetterSqlite3.Database) => void;
}

function addColumnIfMissing(
  db: BetterSqlite3.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = new Set(
    (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((entry) => entry.name)
  );
  if (!columns.has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export const MIGRATIONS: SqliteMigration[] = [
  {
    version: 1,
    name: 'baseline packaging jobs and upload history',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS packaging_jobs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          user_email TEXT,
          tenant_id TEXT,
          winget_id TEXT NOT NULL,
          version TEXT NOT NULL,
          display_name TEXT NOT NULL,
          publisher TEXT,
          architecture TEXT,
          installer_type TEXT NOT NULL,
          installer_url TEXT NOT NULL,
          installer_sha256 TEXT,
          install_command TEXT,
          uninstall_command TEXT,
          install_scope TEXT,
          silent_switches TEXT,
          detection_rules TEXT,
          package_config TEXT,
          github_run_id TEXT,
          github_run_url TEXT,
          intunewin_url TEXT,
          intunewin_size_bytes INTEGER,
          unencrypted_content_size INTEGER,
          encryption_info TEXT,
          intune_app_id TEXT,
          intune_app_url TEXT,
          app_source TEXT DEFAULT 'win32',
          status TEXT NOT NULL DEFAULT 'queued',
          status_message TEXT,
          progress_percent INTEGER DEFAULT 0,
          progress_message TEXT,
          error_message TEXT,
          error_stage TEXT,
          error_category TEXT,
          error_code TEXT,
          error_details TEXT,
          warnings TEXT,
          execution_profile_sha256 TEXT,
          presentation_profile_sha256 TEXT,
          qa_candidate_id TEXT,
          qa_requested_at TEXT,
          qa_completed_at TEXT,
          packager_id TEXT,
          packager_heartbeat_at TEXT,
          claimed_at TEXT,
          packaging_started_at TEXT,
          packaging_completed_at TEXT,
          upload_started_at TEXT,
          completed_at TEXT,
          cancelled_at TEXT,
          cancelled_by TEXT,
          archived_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Databases created before the runner may miss columns added by the old
      // compatibleColumns map. Keep the additive repair for those.
      const legacyColumns: Record<string, string> = {
        app_source: "TEXT DEFAULT 'win32'",
        error_stage: 'TEXT',
        error_category: 'TEXT',
        error_code: 'TEXT',
        error_details: 'TEXT',
        warnings: 'TEXT',
        archived_at: 'TEXT',
        execution_profile_sha256: 'TEXT',
        presentation_profile_sha256: 'TEXT',
        qa_candidate_id: 'TEXT',
        qa_requested_at: 'TEXT',
        qa_completed_at: 'TEXT',
      };
      for (const [column, definition] of Object.entries(legacyColumns)) {
        addColumnIfMissing(db, 'packaging_jobs', column, definition);
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_packaging_jobs_status ON packaging_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_packaging_jobs_user_id ON packaging_jobs(user_id);
        CREATE INDEX IF NOT EXISTS idx_packaging_jobs_created_at ON packaging_jobs(created_at);
        CREATE INDEX IF NOT EXISTS idx_packaging_jobs_packager_heartbeat ON packaging_jobs(packager_heartbeat_at);

        CREATE TABLE IF NOT EXISTS upload_history (
          id TEXT PRIMARY KEY,
          packaging_job_id TEXT,
          user_id TEXT NOT NULL,
          winget_id TEXT NOT NULL,
          version TEXT NOT NULL,
          display_name TEXT NOT NULL,
          publisher TEXT,
          intune_app_id TEXT NOT NULL,
          intune_app_url TEXT,
          intune_tenant_id TEXT,
          deployed_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (packaging_job_id) REFERENCES packaging_jobs(id)
        );

        CREATE INDEX IF NOT EXISTS idx_upload_history_user_id ON upload_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_upload_history_deployed_at ON upload_history(deployed_at);
      `);
    },
  },
  {
    version: 2,
    name: 'update policies and auto update history',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_update_policies (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          winget_id TEXT NOT NULL,
          policy_type TEXT NOT NULL DEFAULT 'notify',
          pinned_version TEXT,
          deployment_config TEXT,
          original_upload_history_id TEXT,
          last_auto_update_at TEXT,
          last_auto_update_version TEXT,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, tenant_id, winget_id)
        );

        CREATE INDEX IF NOT EXISTS idx_app_update_policies_user_id ON app_update_policies(user_id);
        CREATE INDEX IF NOT EXISTS idx_app_update_policies_tenant_id ON app_update_policies(tenant_id);

        CREATE TABLE IF NOT EXISTS auto_update_history (
          id TEXT PRIMARY KEY,
          policy_id TEXT NOT NULL,
          packaging_job_id TEXT,
          from_version TEXT NOT NULL,
          to_version TEXT NOT NULL,
          update_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          error_message TEXT,
          triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT,
          FOREIGN KEY (policy_id) REFERENCES app_update_policies(id) ON DELETE CASCADE,
          FOREIGN KEY (packaging_job_id) REFERENCES packaging_jobs(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_auto_update_history_policy_id ON auto_update_history(policy_id);
        CREATE INDEX IF NOT EXISTS idx_auto_update_history_triggered_at ON auto_update_history(triggered_at);
      `);

      // Auto-update packaging jobs link back to the policy that created them.
      addColumnIfMissing(db, 'packaging_jobs', 'is_auto_update', 'INTEGER DEFAULT 0');
      addColumnIfMissing(db, 'packaging_jobs', 'auto_update_policy_id', 'TEXT');
    },
  },
];

export function getSqliteSchemaVersion(db: BetterSqlite3.Database): number {
  const value = db.pragma('user_version', { simple: true });
  return typeof value === 'number' ? value : 0;
}

/**
 * Apply every migration newer than the database's recorded version. Each
 * migration and its version bump share one transaction, so a failure leaves the
 * database on its previous version.
 */
export function runSqliteMigrations(db: BetterSqlite3.Database): void {
  const currentVersion = getSqliteSchemaVersion(db);
  const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion).sort(
    (a, b) => a.version - b.version
  );

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}
