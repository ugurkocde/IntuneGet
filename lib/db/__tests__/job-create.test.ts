import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Against the real adapter, deliberately. sqlite.test.ts mirrors this INSERT
// by hand, so a statement that is wrong only in lib/db/sqlite.ts passes there
// and fails in production: the column list grew to 31 while the placeholder
// list went to 32, and every deployment in SQLite mode died on
// "32 values for 31 columns".
let dir: string;
let adapter: typeof import('../sqlite').sqliteDb;
let closeDb: typeof import('../sqlite').closeSqliteDb;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'intuneget-jobs-'));
  process.env.DATABASE_PATH = path.join(dir, 'test.db');
  const mod = await import('../sqlite');
  adapter = mod.sqliteDb;
  closeDb = mod.closeSqliteDb;
});

afterEach(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATABASE_PATH;
});

describe('sqlite jobs.create', () => {
  it('inserts a job with only the required fields', async () => {
    const job = await adapter.jobs.create({
      user_id: 'user-1',
      winget_id: 'Zoom.Zoom',
      version: '7.1.46825',
      display_name: 'Zoom Workplace',
      installer_type: 'msi',
      installer_url: 'https://example.com/zoom.msi',
    });

    expect(job.id).toBeTruthy();
    expect(job.winget_id).toBe('Zoom.Zoom');
    expect(job.status).toBe('queued');
    expect(job.progress_percent).toBe(0);
  });

  it('round-trips every column the statement writes', async () => {
    // Touches each of the 31 columns, so a future column added to one list
    // and not the other fails here rather than in a deployment.
    const job = await adapter.jobs.create({
      user_id: 'user-1',
      user_email: 'user@example.com',
      tenant_id: 'tenant-1',
      winget_id: 'Zoom.Zoom',
      version: '7.1.46825',
      display_name: 'Zoom Workplace',
      publisher: 'Zoom',
      architecture: 'x64',
      installer_type: 'msi',
      installer_url: 'https://example.com/zoom.msi',
      installer_sha256: 'A'.repeat(64),
      install_command: 'msiexec /i zoom.msi /qn',
      uninstall_command: 'msiexec /x zoom.msi /qn',
      install_scope: 'machine',
      detection_rules: [{ type: 'msi' }] as never,
      package_config: { displayName: 'Zoom Workplace' } as never,
      app_source: 'win32',
      status: 'awaiting_qa',
      status_message: 'Running an isolated installation test',
      progress_percent: 5,
      error_stage: 'validation',
      error_category: 'installer',
      error_code: 'QA_FAILED_EXECUTION_PROFILE',
      execution_profile_sha256: 'B'.repeat(64),
      presentation_profile_sha256: 'C'.repeat(64),
      qa_candidate_id: 'candidate-1',
      qa_requested_at: '2026-09-09T09:00:00.000Z',
      qa_completed_at: '2026-09-09T09:05:00.000Z',
    });

    expect(job).toMatchObject({
      user_email: 'user@example.com',
      tenant_id: 'tenant-1',
      publisher: 'Zoom',
      architecture: 'x64',
      installer_sha256: 'A'.repeat(64),
      install_scope: 'machine',
      status: 'awaiting_qa',
      status_message: 'Running an isolated installation test',
      progress_percent: 5,
      error_stage: 'validation',
      error_category: 'installer',
      error_code: 'QA_FAILED_EXECUTION_PROFILE',
      execution_profile_sha256: 'B'.repeat(64),
      presentation_profile_sha256: 'C'.repeat(64),
      qa_candidate_id: 'candidate-1',
      qa_requested_at: '2026-09-09T09:00:00.000Z',
      qa_completed_at: '2026-09-09T09:05:00.000Z',
    });
    expect(job.detection_rules).toEqual([{ type: 'msi' }]);
    expect(job.package_config).toEqual({ displayName: 'Zoom Workplace' });
    expect(job.created_at).toBeTruthy();
    expect(job.updated_at).toBeTruthy();
  });
});
