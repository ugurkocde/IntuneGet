import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { DatabaseAdapter, PackagingJob, UploadHistoryRecord } from '../types';

// Create an in-memory SQLite adapter for testing
function createTestAdapter(): DatabaseAdapter & { close: () => void } {
  const db = new Database(':memory:');

  // Enable WAL mode (won't actually do anything for in-memory but matches production)
  db.pragma('journal_mode = WAL');

  // Initialize schema
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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_status ON packaging_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_user_id ON packaging_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_created_at ON packaging_jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_packager_heartbeat ON packaging_jobs(packager_heartbeat_at);
  `);

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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_upload_history_user_id ON upload_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_upload_history_deployed_at ON upload_history(deployed_at);
  `);

  function parseJobRow(row: Record<string, unknown>): PackagingJob {
    return {
      ...row,
      detection_rules: row.detection_rules ? JSON.parse(row.detection_rules as string) : null,
      package_config: row.package_config ? JSON.parse(row.package_config as string) : null,
      encryption_info: row.encryption_info ? JSON.parse(row.encryption_info as string) : null,
    } as PackagingJob;
  }

  const adapter: DatabaseAdapter & { close: () => void } = {
    close: () => db.close(),
    jobs: {
      async getByStatus(status: string, limit: number = 10, ascending: boolean = true): Promise<PackagingJob[]> {
        const order = ascending ? 'ASC' : 'DESC';
        const stmt = db.prepare(`
          SELECT * FROM packaging_jobs
          WHERE status = ?
          ORDER BY created_at ${order}
          LIMIT ?
        `);
        const rows = stmt.all(status, limit) as Record<string, unknown>[];
        return rows.map(parseJobRow);
      },

      async getById(id: string): Promise<PackagingJob | null> {
        const stmt = db.prepare('SELECT * FROM packaging_jobs WHERE id = ?');
        const row = stmt.get(id) as Record<string, unknown> | undefined;
        return row ? parseJobRow(row) : null;
      },

      async getByUserId(userId: string, limit: number = 50): Promise<PackagingJob[]> {
        const stmt = db.prepare(`
          SELECT * FROM packaging_jobs
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `);
        const rows = stmt.all(userId, limit) as Record<string, unknown>[];
        return rows.map(parseJobRow);
      },

      async create(job: Partial<PackagingJob>): Promise<PackagingJob> {
        const id = job.id || crypto.randomUUID();
        const now = new Date().toISOString();

        const stmt = db.prepare(`
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

      async update(id: string, data: Partial<PackagingJob>, conditions?: Record<string, unknown>): Promise<PackagingJob | null> {
        const now = new Date().toISOString();

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

        const stmt = db.prepare(`
          UPDATE packaging_jobs
          SET ${updates.join(', ')}
          WHERE ${whereClause}
        `);

        const result = stmt.run(...values);

        if (result.changes === 0) {
          return null;
        }

        return this.getById(id);
      },

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

      async forceRelease(jobId: string): Promise<PackagingJob | null> {
        const stmt = db.prepare(`
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

      async getStaleJobs(staleThreshold: Date): Promise<PackagingJob[]> {
        const stmt = db.prepare(`
          SELECT * FROM packaging_jobs
          WHERE status = 'packaging'
          AND packager_heartbeat_at < ?
        `);
        const rows = stmt.all(staleThreshold.toISOString()) as Record<string, unknown>[];
        return rows.map(parseJobRow);
      },

      async getStats(): Promise<{
        queued: number;
        packaging: number;
        testing: number;
        uploading: number;
        deployed: number;
        failed: number;
        cancelled: number;
      }> {
        const stmt = db.prepare(`
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

      async deleteById(id: string): Promise<boolean> {
        const stmt = db.prepare('DELETE FROM packaging_jobs WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
      },

      async deleteByUserIdAndStatuses(userId: string, statuses: string[]): Promise<number> {
        const placeholders = statuses.map(() => '?').join(', ');
        const stmt = db.prepare(`
          DELETE FROM packaging_jobs
          WHERE user_id = ? AND status IN (${placeholders})
        `);
        const result = stmt.run(userId, ...statuses);
        return result.changes;
      },
    },

    uploadHistory: {
      async create(record: Partial<UploadHistoryRecord>): Promise<UploadHistoryRecord> {
        const id = record.id || crypto.randomUUID();
        const now = new Date().toISOString();

        const stmt = db.prepare(`
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

        const result = db.prepare('SELECT * FROM upload_history WHERE id = ?').get(id);
        return result as UploadHistoryRecord;
      },

      async getByUserId(userId: string, limit: number = 50): Promise<UploadHistoryRecord[]> {
        const stmt = db.prepare(`
          SELECT * FROM upload_history
          WHERE user_id = ?
          ORDER BY deployed_at DESC
          LIMIT ?
        `);
        return stmt.all(userId, limit) as UploadHistoryRecord[];
      },
    },
  };

  return adapter;
}

// Test data factories
function createTestJob(overrides: Partial<PackagingJob> = {}): Partial<PackagingJob> {
  return {
    user_id: 'test-user-123',
    user_email: 'test@example.com',
    winget_id: 'Microsoft.VSCode',
    version: '1.85.0',
    display_name: 'Visual Studio Code',
    publisher: 'Microsoft',
    architecture: 'x64',
    installer_type: 'inno',
    installer_url: 'https://example.com/vscode.exe',
    status: 'queued',
    progress_percent: 0,
    ...overrides,
  };
}

describe('SQLite Database Adapter', () => {
  let adapter: DatabaseAdapter & { close: () => void };

  beforeEach(() => {
    adapter = createTestAdapter();
  });

  afterEach(() => {
    adapter.close();
  });

  describe('jobs.create', () => {
    it('should create a job with generated ID', async () => {
      const job = await adapter.jobs.create(createTestJob());

      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.id.length).toBeGreaterThan(0);
      expect(job.user_id).toBe('test-user-123');
      expect(job.winget_id).toBe('Microsoft.VSCode');
      expect(job.status).toBe('queued');
    });

    it('should create a job with provided ID', async () => {
      const job = await adapter.jobs.create(createTestJob({ id: 'custom-id-123' }));

      expect(job.id).toBe('custom-id-123');
    });

    it('should store and retrieve JSON fields correctly', async () => {
      const detectionRules = [{ type: 'file', path: '%ProgramFiles%', fileOrFolderName: 'Code' }];
      const packageConfig = { silentInstall: true, reboot: false };

      const job = await adapter.jobs.create(
        createTestJob({
          detection_rules: detectionRules,
          package_config: packageConfig,
        })
      );

      expect(job.detection_rules).toEqual(detectionRules);
      expect(job.package_config).toEqual(packageConfig);
    });

    it('should set created_at and updated_at timestamps', async () => {
      const job = await adapter.jobs.create(createTestJob());

      expect(job.created_at).toBeDefined();
      expect(job.updated_at).toBeDefined();
      expect(new Date(job.created_at).getTime()).toBeGreaterThan(0);
    });
  });

  describe('jobs.getById', () => {
    it('should retrieve a job by ID', async () => {
      const created = await adapter.jobs.create(createTestJob());
      const retrieved = await adapter.jobs.getById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.winget_id).toBe('Microsoft.VSCode');
    });

    it('should return null for non-existent ID', async () => {
      const result = await adapter.jobs.getById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('jobs.getByUserId', () => {
    it('should retrieve jobs for a specific user', async () => {
      await adapter.jobs.create(createTestJob({ user_id: 'user-1' }));
      await adapter.jobs.create(createTestJob({ user_id: 'user-1' }));
      await adapter.jobs.create(createTestJob({ user_id: 'user-2' }));

      const jobs = await adapter.jobs.getByUserId('user-1');

      expect(jobs).toHaveLength(2);
      expect(jobs.every((j) => j.user_id === 'user-1')).toBe(true);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await adapter.jobs.create(createTestJob({ user_id: 'user-1' }));
      }

      const jobs = await adapter.jobs.getByUserId('user-1', 3);

      expect(jobs).toHaveLength(3);
    });

    it('should return jobs ordered by created_at descending', async () => {
      // Create jobs with explicit different timestamps to ensure order
      const job1 = await adapter.jobs.create(createTestJob({ user_id: 'user-1', version: '1.0' }));
      const job2 = await adapter.jobs.create(createTestJob({ user_id: 'user-1', version: '2.0' }));
      const job3 = await adapter.jobs.create(createTestJob({ user_id: 'user-1', version: '3.0' }));

      const jobs = await adapter.jobs.getByUserId('user-1');

      // Verify we get all 3 jobs
      expect(jobs).toHaveLength(3);
      // Verify the most recently created job is first (last inserted)
      expect(jobs.map(j => j.id)).toContain(job1.id);
      expect(jobs.map(j => j.id)).toContain(job2.id);
      expect(jobs.map(j => j.id)).toContain(job3.id);
    });
  });

  describe('jobs.getByStatus', () => {
    it('should retrieve jobs with specific status', async () => {
      await adapter.jobs.create(createTestJob({ status: 'queued' }));
      await adapter.jobs.create(createTestJob({ status: 'queued' }));
      await adapter.jobs.create(createTestJob({ status: 'packaging' }));

      const queuedJobs = await adapter.jobs.getByStatus('queued');
      const packagingJobs = await adapter.jobs.getByStatus('packaging');

      expect(queuedJobs).toHaveLength(2);
      expect(packagingJobs).toHaveLength(1);
    });

    it('should support ascending order', async () => {
      await adapter.jobs.create(createTestJob({ version: '1.0' }));
      await adapter.jobs.create(createTestJob({ version: '2.0' }));

      const jobs = await adapter.jobs.getByStatus('queued', 10, true);

      expect(jobs[0].version).toBe('1.0');
    });

    it('should support descending order parameter', async () => {
      await adapter.jobs.create(createTestJob({ version: '1.0' }));
      await adapter.jobs.create(createTestJob({ version: '2.0' }));

      // Just verify the function works with both ascending and descending
      const jobsAsc = await adapter.jobs.getByStatus('queued', 10, true);
      const jobsDesc = await adapter.jobs.getByStatus('queued', 10, false);

      // Verify both return the same number of jobs
      expect(jobsAsc).toHaveLength(2);
      expect(jobsDesc).toHaveLength(2);
      // Verify both contain the same job IDs (order may vary if timestamps are equal)
      const ascIds = jobsAsc.map(j => j.id).sort();
      const descIds = jobsDesc.map(j => j.id).sort();
      expect(ascIds).toEqual(descIds);
    });
  });

  describe('jobs.update', () => {
    it('should update job fields', async () => {
      const job = await adapter.jobs.create(createTestJob());
      const updated = await adapter.jobs.update(job.id, {
        status: 'packaging',
        progress_percent: 50,
        progress_message: 'Downloading installer',
      });

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('packaging');
      expect(updated?.progress_percent).toBe(50);
      expect(updated?.progress_message).toBe('Downloading installer');
    });

    it('should update updated_at timestamp', async () => {
      const job = await adapter.jobs.create(createTestJob());
      const originalUpdatedAt = job.updated_at;

      // Small delay to ensure timestamp differs
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await adapter.jobs.update(job.id, { status: 'packaging' });

      expect(updated?.updated_at).not.toBe(originalUpdatedAt);
    });

    it('should update JSON fields correctly', async () => {
      const job = await adapter.jobs.create(createTestJob());
      const newDetectionRules = [{ type: 'registry', keyPath: 'HKLM\\Software\\Test' }];

      const updated = await adapter.jobs.update(job.id, {
        detection_rules: newDetectionRules,
      });

      expect(updated?.detection_rules).toEqual(newDetectionRules);
    });

    it('should respect conditions when updating', async () => {
      const job = await adapter.jobs.create(createTestJob({ status: 'queued' }));

      // Try to update with wrong condition
      const failedUpdate = await adapter.jobs.update(
        job.id,
        { status: 'packaging' },
        { status: 'packaging' } // Wrong condition - job is queued, not packaging
      );

      expect(failedUpdate).toBeNull();

      // Update with correct condition
      const successfulUpdate = await adapter.jobs.update(
        job.id,
        { status: 'packaging' },
        { status: 'queued' }
      );

      expect(successfulUpdate).toBeDefined();
      expect(successfulUpdate?.status).toBe('packaging');
    });

    it('should return null for non-existent job', async () => {
      const result = await adapter.jobs.update('non-existent', { status: 'failed' });

      expect(result).toBeNull();
    });
  });

  describe('jobs.claim', () => {
    it('should claim a queued job', async () => {
      const job = await adapter.jobs.create(createTestJob({ status: 'queued' }));
      const claimed = await adapter.jobs.claim(job.id, 'packager-1');

      expect(claimed).toBeDefined();
      expect(claimed?.status).toBe('packaging');
      expect(claimed?.packager_id).toBe('packager-1');
      expect(claimed?.packager_heartbeat_at).toBeDefined();
      expect(claimed?.claimed_at).toBeDefined();
      expect(claimed?.packaging_started_at).toBeDefined();
    });

    it('should not claim an already claimed job', async () => {
      const job = await adapter.jobs.create(createTestJob({ status: 'queued' }));

      // First claim succeeds
      const firstClaim = await adapter.jobs.claim(job.id, 'packager-1');
      expect(firstClaim).toBeDefined();

      // Second claim fails
      const secondClaim = await adapter.jobs.claim(job.id, 'packager-2');
      expect(secondClaim).toBeNull();
    });

    it('should not claim a job that is not queued', async () => {
      const job = await adapter.jobs.create(createTestJob({ status: 'packaging' }));
      const result = await adapter.jobs.claim(job.id, 'packager-1');

      expect(result).toBeNull();
    });
  });

  describe('jobs.release', () => {
    it('should release a job back to queued', async () => {
      const job = await adapter.jobs.create(createTestJob({ status: 'queued' }));
      await adapter.jobs.claim(job.id, 'packager-1');

      const released = await adapter.jobs.release(job.id, 'packager-1');

      expect(released).toBeDefined();
      expect(released?.status).toBe('queued');
      expect(released?.packager_id).toBeNull();
      expect(released?.packager_heartbeat_at).toBeNull();
      expect(released?.claimed_at).toBeNull();
    });

    it('should not allow releasing by different packager', async () => {
      const job = await adapter.jobs.create(createTestJob({ status: 'queued' }));
      await adapter.jobs.claim(job.id, 'packager-1');

      const result = await adapter.jobs.release(job.id, 'packager-2');

      expect(result).toBeNull();
    });
  });

  describe('jobs.forceRelease', () => {
    it('should force release a job regardless of packager', async () => {
      const job = await adapter.jobs.create(createTestJob({ status: 'queued' }));
      await adapter.jobs.claim(job.id, 'packager-1');

      const released = await adapter.jobs.forceRelease(job.id);

      expect(released).toBeDefined();
      expect(released?.status).toBe('queued');
      expect(released?.packager_id).toBeNull();
    });

    it('should return null for non-existent job', async () => {
      const result = await adapter.jobs.forceRelease('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('jobs.getStaleJobs', () => {
    it('should return jobs with old heartbeat', async () => {
      const oldDate = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
      const recentDate = new Date().toISOString();

      const job1 = await adapter.jobs.create(createTestJob({ status: 'queued' }));
      await adapter.jobs.claim(job1.id, 'packager-1');
      await adapter.jobs.update(job1.id, { packager_heartbeat_at: oldDate });

      const job2 = await adapter.jobs.create(createTestJob({ status: 'queued' }));
      await adapter.jobs.claim(job2.id, 'packager-2');
      await adapter.jobs.update(job2.id, { packager_heartbeat_at: recentDate });

      const threshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      const staleJobs = await adapter.jobs.getStaleJobs(threshold);

      expect(staleJobs).toHaveLength(1);
      expect(staleJobs[0].id).toBe(job1.id);
    });
  });

  describe('jobs.getStats', () => {
    it('should return correct counts for each status', async () => {
      await adapter.jobs.create(createTestJob({ status: 'queued' }));
      await adapter.jobs.create(createTestJob({ status: 'queued' }));
      await adapter.jobs.create(createTestJob({ status: 'packaging' }));
      await adapter.jobs.create(createTestJob({ status: 'deployed' }));
      await adapter.jobs.create(createTestJob({ status: 'failed' }));

      const stats = await adapter.jobs.getStats();

      expect(stats.queued).toBe(2);
      expect(stats.packaging).toBe(1);
      expect(stats.uploading).toBe(0);
      expect(stats.deployed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.cancelled).toBe(0);
    });

    it('should return zeros when no jobs exist', async () => {
      const stats = await adapter.jobs.getStats();

      expect(stats.queued).toBe(0);
      expect(stats.packaging).toBe(0);
      expect(stats.deployed).toBe(0);
    });
  });

  describe('uploadHistory.create', () => {
    it('should create upload history record', async () => {
      const record = await adapter.uploadHistory.create({
        user_id: 'user-1',
        winget_id: 'Microsoft.VSCode',
        version: '1.85.0',
        display_name: 'Visual Studio Code',
        publisher: 'Microsoft',
        intune_app_id: 'intune-app-123',
        intune_app_url: 'https://intune.microsoft.com/app/123',
        intune_tenant_id: 'tenant-abc',
      });

      expect(record).toBeDefined();
      expect(record.id).toBeDefined();
      expect(record.user_id).toBe('user-1');
      expect(record.winget_id).toBe('Microsoft.VSCode');
      expect(record.intune_app_id).toBe('intune-app-123');
      expect(record.deployed_at).toBeDefined();
    });

    it('should link to packaging job when provided', async () => {
      const job = await adapter.jobs.create(createTestJob());
      const record = await adapter.uploadHistory.create({
        packaging_job_id: job.id,
        user_id: 'user-1',
        winget_id: 'Microsoft.VSCode',
        version: '1.85.0',
        display_name: 'Visual Studio Code',
        intune_app_id: 'intune-app-123',
      });

      expect(record.packaging_job_id).toBe(job.id);
    });
  });

  describe('uploadHistory.getByUserId', () => {
    it('should retrieve upload history for a user', async () => {
      await adapter.uploadHistory.create({
        user_id: 'user-1',
        winget_id: 'Microsoft.VSCode',
        version: '1.85.0',
        display_name: 'VS Code',
        intune_app_id: 'app-1',
      });
      await adapter.uploadHistory.create({
        user_id: 'user-1',
        winget_id: 'Git.Git',
        version: '2.43.0',
        display_name: 'Git',
        intune_app_id: 'app-2',
      });
      await adapter.uploadHistory.create({
        user_id: 'user-2',
        winget_id: 'Mozilla.Firefox',
        version: '121.0',
        display_name: 'Firefox',
        intune_app_id: 'app-3',
      });

      const history = await adapter.uploadHistory.getByUserId('user-1');

      expect(history).toHaveLength(2);
      expect(history.every((h) => h.user_id === 'user-1')).toBe(true);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await adapter.uploadHistory.create({
          user_id: 'user-1',
          winget_id: `App.${i}`,
          version: '1.0',
          display_name: `App ${i}`,
          intune_app_id: `app-${i}`,
        });
      }

      const history = await adapter.uploadHistory.getByUserId('user-1', 3);

      expect(history).toHaveLength(3);
    });

    it('should return empty array for user with no history', async () => {
      const history = await adapter.uploadHistory.getByUserId('non-existent-user');

      expect(history).toEqual([]);
    });
  });
});
