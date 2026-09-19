/**
 * SQLite Database Implementation for Self-Hosted Mode
 * Provides a simple, zero-dependency database for true self-hosting
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type {
  DatabaseAdapter,
  PackagingJob,
  UploadHistoryRecord,
  AutoUpdateHistoryQuery,
} from './types';
import type {
  AppUpdatePolicy,
  AutoUpdateHistory,
  AutoUpdateHistoryWithPolicy,
} from '@/types/update-policies';
import { runSqliteMigrations } from './sqlite-migrations';

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

  // Apply versioned migrations (baseline, then additive changes)
  runSqliteMigrations(db);

  return db;
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
    error_details: row.error_details ? JSON.parse(row.error_details as string) : null,
    warnings: row.warnings ? JSON.parse(row.warnings as string) : null,
  } as PackagingJob;
}

function parsePolicyRow(row: Record<string, unknown>): AppUpdatePolicy {
  return {
    ...row,
    is_enabled: Boolean(row.is_enabled),
    deployment_config: row.deployment_config ? JSON.parse(row.deployment_config as string) : null,
  } as unknown as AppUpdatePolicy;
}

function parseHistoryRow(row: Record<string, unknown>): AutoUpdateHistory {
  return row as unknown as AutoUpdateHistory;
}

/**
 * Build the SET clause shared by the dynamic update methods.
 */
function buildSetClause(
  data: Record<string, unknown>,
  options: { json?: Set<string>; boolean?: Set<string> } = {}
): { clause: string; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(data)) {
    assignments.push(`${key} = ?`);
    if (options.json?.has(key)) {
      values.push(value != null ? JSON.stringify(value) : null);
    } else if (options.boolean?.has(key)) {
      values.push(value ? 1 : 0);
    } else {
      values.push(value);
    }
  }
  return { clause: assignments.join(', '), values };
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
        WHERE status = ? AND archived_at IS NULL
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
      // Return the most recent jobs for the user with no age cutoff, so the
      // Uploads (all activities) view shows older completed deployments too.
      const stmt = database.prepare(`
        SELECT * FROM packaging_jobs
        WHERE user_id = ? AND archived_at IS NULL
        ORDER BY created_at DESC
        LIMIT ?
      `);
      const rows = stmt.all(userId, limit) as Record<string, unknown>[];
      return rows.map(parseJobRow);
    },

    async getByTenantId(tenantId: string, limit: number = 50): Promise<PackagingJob[]> {
      const database = getDb();
      // Every user's jobs in this tenant, most recent first, no age cutoff.
      const stmt = database.prepare(`
        SELECT * FROM packaging_jobs
        WHERE tenant_id = ? AND archived_at IS NULL
        ORDER BY created_at DESC
        LIMIT ?
      `);
      const rows = stmt.all(tenantId, limit) as Record<string, unknown>[];
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
          package_config, app_source, status, status_message, progress_percent,
          error_stage, error_category, error_code, execution_profile_sha256,
          presentation_profile_sha256, qa_candidate_id, qa_requested_at,
          qa_completed_at, is_auto_update, auto_update_policy_id, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
        job.app_source || 'win32',
        job.status || 'queued',
        job.status_message || null,
        job.progress_percent || 0,
        job.error_stage || null,
        job.error_category || null,
        job.error_code || null,
        job.execution_profile_sha256 || null,
        job.presentation_profile_sha256 || null,
        job.qa_candidate_id || null,
        job.qa_requested_at || null,
        job.qa_completed_at || null,
        (job as Record<string, unknown>).is_auto_update ? 1 : 0,
        (job as Record<string, unknown>).auto_update_policy_id || null,
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
        if (key === 'detection_rules' || key === 'package_config' || key === 'encryption_info' || key === 'warnings' || key === 'error_details') {
          updates.push(`${key} = ?`);
          values.push(value ? JSON.stringify(value) : null);
        } else if (key === 'is_auto_update') {
          updates.push(`${key} = ?`);
          values.push(value ? 1 : 0);
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
      uploading: number;
      deployed: number;
      failed: number;
      cancelled: number;
    }> {
      const database = getDb();
      const stmt = database.prepare(`
        SELECT status, COUNT(*) as count
        FROM packaging_jobs
        WHERE archived_at IS NULL
        GROUP BY status
      `);
      const rows = stmt.all() as Array<{ status: string; count: number }>;

      const stats = {
        queued: 0,
        packaging: 0,
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

    /** Soft-archive a single job by ID. */
    async deleteById(id: string): Promise<boolean> {
      const database = getDb();
      const now = new Date().toISOString();
      const stmt = database.prepare(
        'UPDATE packaging_jobs SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL',
      );
      const result = stmt.run(now, now, id);
      return result.changes > 0;
    },

    /** Bulk-archive jobs matching a user ID and a set of statuses. */
    async deleteByUserIdAndStatuses(userId: string, statuses: string[]): Promise<number> {
      const database = getDb();
      const placeholders = statuses.map(() => '?').join(', ');
      const stmt = database.prepare(`
        UPDATE packaging_jobs
        SET archived_at = ?, updated_at = ?
        WHERE user_id = ? AND status IN (${placeholders}) AND archived_at IS NULL
      `);
      const now = new Date().toISOString();
      const result = stmt.run(now, now, userId, ...statuses);
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

  updatePolicies: {
    async list(userId: string, tenantId?: string): Promise<AppUpdatePolicy[]> {
      const database = getDb();
      const stmt = tenantId
        ? database.prepare(
            'SELECT * FROM app_update_policies WHERE user_id = ? AND tenant_id = ? ORDER BY updated_at DESC'
          )
        : database.prepare('SELECT * FROM app_update_policies WHERE user_id = ? ORDER BY updated_at DESC');
      const rows = (tenantId ? stmt.all(userId, tenantId) : stmt.all(userId)) as Record<string, unknown>[];
      return rows.map(parsePolicyRow);
    },

    async getById(id: string, userId: string): Promise<AppUpdatePolicy | null> {
      const database = getDb();
      const row = database
        .prepare('SELECT * FROM app_update_policies WHERE id = ? AND user_id = ?')
        .get(id, userId) as Record<string, unknown> | undefined;
      return row ? parsePolicyRow(row) : null;
    },

    async getByKey(userId: string, tenantId: string, wingetId: string): Promise<AppUpdatePolicy | null> {
      const database = getDb();
      const row = database
        .prepare(
          'SELECT * FROM app_update_policies WHERE user_id = ? AND tenant_id = ? AND winget_id = ?'
        )
        .get(userId, tenantId, wingetId) as Record<string, unknown> | undefined;
      return row ? parsePolicyRow(row) : null;
    },

    async upsert(
      policy: Partial<AppUpdatePolicy> & Pick<AppUpdatePolicy, 'user_id' | 'tenant_id' | 'winget_id' | 'policy_type'>
    ): Promise<AppUpdatePolicy> {
      const database = getDb();
      const id = policy.id || crypto.randomUUID();
      const now = new Date().toISOString();

      database
        .prepare(
          `INSERT INTO app_update_policies (
             id, user_id, tenant_id, winget_id, policy_type, pinned_version,
             deployment_config, original_upload_history_id, last_auto_update_at,
             last_auto_update_version, is_enabled, consecutive_failures, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, tenant_id, winget_id) DO UPDATE SET
             policy_type = excluded.policy_type,
             pinned_version = excluded.pinned_version,
             deployment_config = excluded.deployment_config,
             original_upload_history_id = excluded.original_upload_history_id,
             is_enabled = excluded.is_enabled,
             updated_at = excluded.updated_at`
        )
        .run(
          id,
          policy.user_id,
          policy.tenant_id,
          policy.winget_id,
          policy.policy_type,
          policy.pinned_version ?? null,
          policy.deployment_config ? JSON.stringify(policy.deployment_config) : null,
          policy.original_upload_history_id ?? null,
          policy.last_auto_update_at ?? null,
          policy.last_auto_update_version ?? null,
          policy.is_enabled === false ? 0 : 1,
          policy.consecutive_failures ?? 0,
          policy.created_at || now,
          policy.updated_at || now
        );

      const row = database
        .prepare(
          'SELECT * FROM app_update_policies WHERE user_id = ? AND tenant_id = ? AND winget_id = ?'
        )
        .get(policy.user_id, policy.tenant_id, policy.winget_id) as Record<string, unknown>;
      return parsePolicyRow(row);
    },

    async update(id: string, userId: string, data: Partial<AppUpdatePolicy>): Promise<AppUpdatePolicy | null> {
      const database = getDb();
      const { clause, values } = buildSetClause(data as Record<string, unknown>, {
        json: new Set(['deployment_config']),
        boolean: new Set(['is_enabled']),
      });
      if (!clause) {
        return this.getById(id, userId);
      }

      const result = database
        .prepare(`UPDATE app_update_policies SET ${clause} WHERE id = ? AND user_id = ?`)
        .run(...values, id, userId);

      if (result.changes === 0) {
        return null;
      }
      return this.getById(id, userId);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const database = getDb();
      const result = database
        .prepare('DELETE FROM app_update_policies WHERE id = ? AND user_id = ?')
        .run(id, userId);
      return result.changes > 0;
    },
  },

  autoUpdateHistory: {
    async create(
      record: Partial<AutoUpdateHistory> &
        Pick<AutoUpdateHistory, 'policy_id' | 'from_version' | 'to_version' | 'update_type'>
    ): Promise<AutoUpdateHistory> {
      const database = getDb();
      const id = record.id || crypto.randomUUID();
      const now = new Date().toISOString();

      database
        .prepare(
          `INSERT INTO auto_update_history (
             id, policy_id, packaging_job_id, from_version, to_version,
             update_type, status, error_message, triggered_at, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          record.policy_id,
          record.packaging_job_id ?? null,
          record.from_version,
          record.to_version,
          record.update_type,
          record.status ?? 'pending',
          record.error_message ?? null,
          record.triggered_at || now,
          record.completed_at ?? null
        );

      const row = database.prepare('SELECT * FROM auto_update_history WHERE id = ?').get(id) as Record<string, unknown>;
      return parseHistoryRow(row);
    },

    async update(id: string, data: Partial<AutoUpdateHistory>): Promise<AutoUpdateHistory | null> {
      const database = getDb();
      const { clause, values } = buildSetClause(data as Record<string, unknown>);
      if (!clause) {
        const row = database.prepare('SELECT * FROM auto_update_history WHERE id = ?').get(id) as
          | Record<string, unknown>
          | undefined;
        return row ? parseHistoryRow(row) : null;
      }

      const result = database
        .prepare(`UPDATE auto_update_history SET ${clause} WHERE id = ?`)
        .run(...values, id);
      if (result.changes === 0) {
        return null;
      }
      const row = database.prepare('SELECT * FROM auto_update_history WHERE id = ?').get(id) as Record<string, unknown>;
      return parseHistoryRow(row);
    },

    async list(userId: string, query: AutoUpdateHistoryQuery): Promise<AutoUpdateHistoryWithPolicy[]> {
      const database = getDb();
      const conditions = ['p.user_id = ?'];
      const values: unknown[] = [userId];

      if (query.tenantId) {
        conditions.push('p.tenant_id = ?');
        values.push(query.tenantId);
      }
      if (query.wingetId) {
        conditions.push('p.winget_id = ?');
        values.push(query.wingetId);
      }
      if (query.status) {
        conditions.push('h.status = ?');
        values.push(query.status);
      }

      const stmt = database.prepare(`
        SELECT
          h.*,
          p.winget_id AS policy_winget_id,
          p.tenant_id AS policy_tenant_id,
          j.display_name AS packaging_display_name
        FROM auto_update_history h
        JOIN app_update_policies p ON h.policy_id = p.id
        LEFT JOIN packaging_jobs j ON h.packaging_job_id = j.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY h.triggered_at DESC
        LIMIT ? OFFSET ?
      `);

      const rows = stmt.all(...values, query.limit, query.offset) as Record<string, unknown>[];
      return rows.map((row) => ({
        id: row.id as string,
        policy_id: row.policy_id as string,
        packaging_job_id: (row.packaging_job_id as string | null) ?? null,
        from_version: row.from_version as string,
        to_version: row.to_version as string,
        update_type: row.update_type as AutoUpdateHistory['update_type'],
        status: row.status as AutoUpdateHistory['status'],
        error_message: (row.error_message as string | null) ?? null,
        triggered_at: row.triggered_at as string,
        completed_at: (row.completed_at as string | null) ?? null,
        policy: {
          winget_id: row.policy_winget_id as string,
          tenant_id: row.policy_tenant_id as string,
        },
        display_name: (row.packaging_display_name as string | null) ?? undefined,
      }));
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
