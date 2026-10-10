import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { PackagingJob } from '../types';

// Adapted from Catscrash's PR #1112. sqlite.test.ts copies the adapter's SQL,
// so it passed while the real INSERT had 32 placeholders for 31 columns.
// Exercise the real adapter, including migrations and the persisted bindings.
let dir: string | undefined;
let databasePath: string;
let adapter: typeof import('../sqlite').sqliteDb;
let closeDb: typeof import('../sqlite').closeSqliteDb | undefined;
const timestamp = '2026-10-08T04:00:00.000Z';

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(timestamp));
  dir = mkdtempSync(join(tmpdir(), 'intuneget-job-create-'));
  databasePath = join(dir, 'test.db');
  vi.stubEnv('DATABASE_PATH', databasePath);
  const mod = await import('../sqlite');
  adapter = mod.sqliteDb;
  closeDb = mod.closeSqliteDb;
});

afterEach(() => {
  try {
    closeDb?.();
    if (dir) {
      // Close WAL connections first, and verify the generated cleanup target.
      const target = resolve(dir);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('intuneget-job-create-')) {
        throw new Error('Unexpected SQLite fixture cleanup target');
      }
      rmSync(target, { recursive: true, force: true });
    }
  } finally {
    dir = undefined;
    closeDb = undefined;
    vi.unstubAllEnvs();
    vi.useRealTimers();
  }
});

function readStoredJob(id: string): Record<string, unknown> {
  closeDb?.();
  const stored = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    // Version 5 adds claimed apps after the licence attestations.
    expect(stored.pragma('user_version', { simple: true })).toBe(5);
    return stored.prepare('SELECT * FROM packaging_jobs WHERE id = ?').get(id) as Record<string, unknown>;
  } finally {
    stored.close();
  }
}

describe('real SQLite jobs.create', () => {
  it('persists required fields and defaults on a freshly migrated database', async () => {
    const input = {
      user_id: 'minimal-user',
      winget_id: 'Example.Minimal',
      version: '1.2.3',
      display_name: 'Minimal fixture',
      installer_type: 'msi',
      installer_url: 'https://example.com/minimal.msi',
    };
    const job = await adapter.jobs.create(input);

    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job).toMatchObject({ ...input, status: 'queued', progress_percent: 0, app_source: 'win32' });
    expect(job.is_auto_update).toBeFalsy();
    expect(readStoredJob(job.id)).toMatchObject({
      ...input,
      id: job.id,
      status: 'queued',
      progress_percent: 0,
      app_source: 'win32',
      user_email: null,
      tenant_id: null,
      detection_rules: null,
      package_config: null,
      is_auto_update: 0,
      auto_update_policy_id: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
  });

  it('round-trips every current INSERT binding through a fresh connection', async () => {
    const input: Partial<PackagingJob> = {
      id: 'full-job',
      user_id: 'full-user',
      user_email: 'fixture@example.com',
      tenant_id: 'fixture-tenant',
      winget_id: 'Example.Full',
      version: '7.8.9',
      display_name: 'Full fixture',
      publisher: 'Fixture publisher',
      architecture: 'x64',
      installer_type: 'exe',
      installer_url: 'https://example.com/full.exe',
      installer_sha256: 'A'.repeat(64),
      install_command: 'full.exe /install /quiet',
      uninstall_command: 'full.exe /uninstall /quiet',
      install_scope: 'machine',
      detection_rules: [{ type: 'msi', productCode: '{00000000-0000-0000-0000-000000000001}' }],
      package_config: { displayName: 'Full configuration' },
      app_source: 'store',
      status: 'awaiting_qa',
      status_message: 'Fixture waiting for qualification',
      progress_percent: 7,
      error_stage: 'validation',
      error_category: 'installer',
      error_code: 'FIXTURE_ERROR',
      execution_profile_sha256: 'B'.repeat(64),
      presentation_profile_sha256: 'C'.repeat(64),
      qa_candidate_id: 'fixture-candidate',
      qa_requested_at: '2026-10-08T03:00:00.000Z',
      qa_completed_at: '2026-10-08T03:05:00.000Z',
      is_auto_update: true,
      auto_update_policy_id: 'fixture-policy',
    };
    const job = await adapter.jobs.create(input);
    const expected = { ...input, created_at: timestamp, updated_at: timestamp };

    // SQLite currently returns its stored INTEGER for this field. Preserve
    // that runtime behaviour while checking the auto-update link explicitly.
    expect(job).toMatchObject({ ...expected, is_auto_update: 1 });
    expect(readStoredJob(job.id)).toMatchObject({
      ...expected,
      detection_rules: JSON.stringify(input.detection_rules),
      package_config: JSON.stringify(input.package_config),
      is_auto_update: 1,
    });
  });
});
