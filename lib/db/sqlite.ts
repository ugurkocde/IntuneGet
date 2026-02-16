/**
 * SQLite Database Implementation for Self-Hosted Mode
 * Provides a simple, zero-dependency database for true self-hosting
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { DatabaseAdapter, PackagingJob, UploadHistoryRecord } from './types';

// Singleton database instance
let db: Database.Database | null = null;

/**
 * Get or create the SQLite database instance
 */
function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DATABASE_PATH || './data/intuneget.db';
  const dbDir = path.dirname(dbPath);

  // Ensure the data directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Initialize schema
  initializeSchema(db);

  return db;
}

/**
 * Initialize the database schema
 */
function initializeSchema(db: Database.Database): void {
  // Create packaging_jobs table
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
      status TEXT NOT NULL DEFAULT 'queued',
      status_message TEXT,
      progress_percent INTEGER DEFAULT 0,
      progress_message TEXT,
      error_message TEXT,
      packager_id TEXT,
      packager_heartbeat_at TEXT,
      claimed_at TEXT,
      packaging_started_at TEXT,
      packaging_completed_at TEXT,
      upload_started_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      cancelled_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Create index for status queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_status ON packaging_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_user_id ON packaging_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_created_at ON packaging_jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_packager_heartbeat ON packaging_jobs(packager_heartbeat_at);
  `);

  // Create upload_history table
  db.exec(`
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
    )
  `);

  // Create index for upload_history
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_upload_history_user_id ON upload_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_upload_history_deployed_at ON upload_history(deployed_at);
  `);
}

/**
 * Parse JSON fields from database row
 */
function parseJobRow(row: Record<string, unknown>): PackagingJob {
  return {
    ...row,
    detection_rules: row.detection_rules ? JSON.parse(row.detection_rules as string) : null,
    package_config: row.package_config ? JSON.parse(row.package_config as string) : null,
    encryption_info: row.encryption_info ? JSON.parse(row.encryption_info as string) : null,
  } as PackagingJob;
}

/**
 * SQLite implementation of the database adapter
 */
export const sqliteDb: DatabaseAdapter = {
  jobs: {
    /**
     * Get jobs by status
     */
    async getByStatus(status: string, limit: number = 10, ascending: boolean = true): Promise<PackagingJob[]> {
      const database = getDb();
      const order = ascending ? 'ASC' : 'DESC';
      const stmt = database.prepare(`
        SELECT * FROM packaging_jobs
        WHERE status = ?
        ORDER BY created_at ${order}
        LIMIT ?
      `);
      const rows = stmt.all(status, limit) as Record<string, unknown>[];
      return rows.map(parseJobRow);
    },

    /**
     * Get a job by ID
     */
    async getById(id: string): Promise<PackagingJob | null> {
      const database = getDb();
      const stmt = database.prepare('SELECT * FROM packaging_jobs WHERE id = ?');
      const row = stmt.get(id) as Record<string, unknown> | undefined;
      return row ? parseJobRow(row) : null;
    },

    /**
     * Get jobs by user ID
     * Auto-excludes terminal-state jobs older than 7 days
     */
    async getByUserId(userId: string, limit: number = 50): Promise<PackagingJob[]> {
      const database = getDb();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const stmt = database.prepare(`
        SELECT * FROM packaging_jobs
        WHERE user_id = ?
        AND (
          status IN ('queued', 'packaging', 'testing', 'uploading')
          OR created_at >= ?
        )
        ORDER BY created_at DESC
        LIMIT ?
      `);
      const rows = stmt.all(userId, sevenDaysAgo, limit) as Record<string, unknown>[];
      return rows.map(parseJobRow);
    },

    /**
     * Create a new job
     */
    async create(job: Partial<PackagingJob>): Promise<PackagingJob> {
      const database = getDb();
      const id = job.id || crypto.randomUUID();
      const now = new Date().toISOString();

      const stmt = database.prepare(`
        INSERT INTO packaging_jobs (
          id, user_id, user_email, tenant_id, winget_id, version, display_name,
          publisher, architecture, installer_type, installer_url, installer_sha256,
          install_command, uninstall_command, install_scope, detection_rules,
          package_config, status, progress_percent, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);

      stmt.run(
        id,
        job.user_id,
        job.user_email || null,
        job.tenant_id || null,
        job.winget_id,
        job.version,
        job.display_name,
        job.publisher || null,
        job.architecture || null,
        job.installer_type,
        job.installer_url,
        job.installer_sha256 || null,
        job.install_command || null,
        job.uninstall_command || null,
        job.install_scope || null,
        job.detection_rules ? JSON.stringify(job.detection_rules) : null,
        job.package_config ? JSON.stringify(job.package_config) : null,
        job.status || 'queued',
        job.progress_percent || 0,
        now,
        now
      );

      return this.getById(id) as Promise<PackagingJob>;
    },

    /**
     * Update a job
     */
    async update(id: string, data: Partial<PackagingJob>, conditions?: Record<string, unknown>): Promise<PackagingJob | null> {
      const database = getDb();
      const now = new Date().toISOString();

      // Build the SET clause
      const updates: string[] = ['updated_at = ?'];
      const values: unknown[] = [now];

      for (const [key, value] of Object.entries(data)) {
        if (key === 'detection_rules' || key === 'package_config' || key === 'encryption_info') {
          updates.push(`${key} = ?`);
          values.push(value ? JSON.stringify(value) : null);
        } else {
          updates.push(`${key} = ?`);
          values.push(value);
        }
      }

      // Build the WHERE clause
      let whereClause = 'id = ?';
      values.push(id);

      if (conditions) {
        for (const [key, value] of Object.entries(conditions)) {
          if (value === null) {
            whereClause += ` AND ${key} IS NULL`;
          } else {
            whereClause += ` AND ${key} = ?`;
            values.push(value);
          }
        }
      }

      const stmt = database.prepare(`
        UPDATE packaging_jobs
        SET ${updates.join(', ')}
        WHERE ${whereClause}
      `);

      const result = stmt.run(...values);

      // Check if the update was successful
      if (result.changes === 0) {
        return null;
      }

      return this.getById(id);
    },

    /**
     * Claim a job atomically (only if status is 'queued')
     */
    async claim(jobId: string, packagerId: string): Promise<PackagingJob | null> {
      const now = new Date().toISOString();

      return this.update(
        jobId,
        {
          status: 'packaging',
          packager_id: packagerId,
          packager_heartbeat_at: now,
          claimed_at: now,
          packaging_started_at: now,
        },
        { status: 'queued' }
      );
    },

    /**
     * Release a job back to queued state
     */
    async release(jobId: string, packagerId: string): Promise<PackagingJob | null> {
      return this.update(
        jobId,
        {
          status: 'queued',
          packager_id: null,
          packager_heartbeat_at: null,
          claimed_at: null,
          packaging_started_at: null,
        },
        { packager_id: packagerId }
      );
    },

    /**
     * Force release a stale job back to queued state (no packager_id check)
     */
    async forceRelease(jobId: string): Promise<PackagingJob | null> {
      const database = getDb();
      const stmt = database.prepare(`
        UPDATE packaging_jobs
        SET status = 'queued',
            packager_id = NULL,
            packager_heartbeat_at = NULL,
            claimed_at = NULL,
            packaging_started_at = NULL,
            updated_at = ?
        WHERE id = ?
      `);

      const result = stmt.run(new Date().toISOString(), jobId);

      if (result.changes === 0) {
        return null;
      }

      return this.getById(jobId);
    },

    /**
     * Get stale jobs (packaging status with old heartbeat)
     */
    async getStaleJobs(staleThreshold: Date): Promise<PackagingJob[]> {
      const database = getDb();
      const stmt = database.prepare(`
        SELECT * FROM packaging_jobs
        WHERE status = 'packaging'
        AND packager_heartbeat_at < ?
      `);
      const rows = stmt.all(staleThreshold.toISOString()) as Record<string, unknown>[];
      return rows.map(parseJobRow);
    },

    /**
     * Get job statistics
     */
    async getStats(): Promise<{
      queued: number;
      packaging: number;
      testing: number;
      uploading: number;
      deployed: number;
      failed: number;
      cancelled: number;
    }> {
      const database = getDb();
      const stmt = database.prepare(`
        SELECT status, COUNT(*) as count
        FROM packaging_jobs
        GROUP BY status
      `);
      const rows = stmt.all() as Array<{ status: string; count: number }>;

      const stats = {
        queued: 0,
        packaging: 0,
        testing: 0,
        uploading: 0,
        deployed: 0,
        failed: 0,
        cancelled: 0,
      };

      for (const row of rows) {
        if (row.status in stats) {
          stats[row.status as keyof typeof stats] = row.count;
        }
      }

      return stats;
    },

    /**
     * Delete a single job by ID
     */
    async deleteById(id: string): Promise<boolean> {
      const database = getDb();
      // Clear FK reference in msp_batch_deployment_items if the table exists
      try {
        database.prepare('UPDATE msp_batch_deployment_items SET packaging_job_id = NULL WHERE packaging_job_id = ?').run(id);
      } catch {
        // Table may not exist in self-hosted mode
      }
      const stmt = database.prepare('DELETE FROM packaging_jobs WHERE id = ?');
      const result = stmt.run(id);
      return result.changes > 0;
    },

    /**
     * Bulk-delete jobs matching a user ID and a set of statuses
     */
    async deleteByUserIdAndStatuses(userId: string, statuses: string[]): Promise<number> {
      const database = getDb();
      const placeholders = statuses.map(() => '?').join(', ');
      // Clear FK references in msp_batch_deployment_items if the table exists
      try {
        database.prepare(`
          UPDATE msp_batch_deployment_items SET packaging_job_id = NULL
          WHERE packaging_job_id IN (
            SELECT id FROM packaging_jobs WHERE user_id = ? AND status IN (${placeholders})
          )
        `).run(userId, ...statuses);
      } catch {
        // Table may not exist in self-hosted mode
      }
      const stmt = database.prepare(`
        DELETE FROM packaging_jobs
        WHERE user_id = ? AND status IN (${placeholders})
      `);
      const result = stmt.run(userId, ...statuses);
      return result.changes;
    },
  },

  uploadHistory: {
    /**
     * Create an upload history record
     */
    async create(record: Partial<UploadHistoryRecord>): Promise<UploadHistoryRecord> {
      const database = getDb();
      const id = record.id || crypto.randomUUID();
      const now = new Date().toISOString();

      const stmt = database.prepare(`
        INSERT INTO upload_history (
          id, packaging_job_id, user_id, winget_id, version, display_name,
          publisher, intune_app_id, intune_app_url, intune_tenant_id, deployed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        record.packaging_job_id || null,
        record.user_id,
        record.winget_id,
        record.version,
        record.display_name,
        record.publisher || null,
        record.intune_app_id,
        record.intune_app_url || null,
        record.intune_tenant_id || null,
        record.deployed_at || now
      );

      const result = database.prepare('SELECT * FROM upload_history WHERE id = ?').get(id);
      return result as UploadHistoryRecord;
    },

    /**
     * Get upload history by user ID
     */
    async getByUserId(userId: string, limit: number = 50): Promise<UploadHistoryRecord[]> {
      const database = getDb();
      const stmt = database.prepare(`
        SELECT * FROM upload_history
        WHERE user_id = ?
        ORDER BY deployed_at DESC
        LIMIT ?
      `);
      return stmt.all(userId, limit) as UploadHistoryRecord[];
    },
  },
};

/**
 * Close the database connection (for cleanup)
 */
export function closeSqliteDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
