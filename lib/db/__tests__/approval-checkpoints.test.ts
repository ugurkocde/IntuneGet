import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let tempDir: string;
beforeEach(() => { vi.resetModules(); tempDir = mkdtempSync(join(tmpdir(), 'approval-checkpoint-')); process.env.DATABASE_PATH = join(tempDir, 'app.db'); });
afterEach(async () => { (await import('@/lib/db/sqlite')).closeSqliteDb(); rmSync(tempDir, { recursive: true, force: true }); delete process.env.DATABASE_PATH; });

describe('SQLite approval checkpoint query', () => {
  it('includes archived failures from another user and version while excluding unrelated tenant/app/status', async () => {
    const { sqliteDb: db } = await import('@/lib/db/sqlite');
    for (const [id, tenant, app, status, category, code] of [
      ['retained', 'tenant', 'Vendor.App', 'failed', 'approval', null],
      ['coded', 'tenant', 'Vendor.App', 'failed', 'system', 'INTUNE_APPROVAL_REQUIRED'],
      ['otherTenant', 'other', 'Vendor.App', 'failed', 'approval', null],
      ['otherApp', 'tenant', 'Vendor.Other', 'failed', 'approval', null],
      ['deployed', 'tenant', 'Vendor.App', 'deployed', 'approval', null],
      ['ordinary', 'tenant', 'Vendor.App', 'failed', 'network', null],
    ]) {
      await db.jobs.create({ id: id!, user_id: 'other-user', tenant_id: tenant!, winget_id: app!, version: 'older', display_name: 'App', status: 'queued',
        installer_type: 'exe', installer_url: 'https://example.com/test.exe', installer_sha256: 'A'.repeat(64) });
      await db.jobs.update(id!, { status: status!, error_category: category, error_code: code, archived_at: new Date().toISOString() });
    }
    expect((await db.jobs.getApprovalFailures('tenant', 'Vendor.App')).map(r => r.id).sort()).toEqual(['coded', 'retained']);
  });

  it('reads the next page without skipping equal timestamps', async () => {
    const { sqliteDb: db } = await import('@/lib/db/sqlite');
    for (let i = 0; i < 101; i++) {
      const id = String(i).padStart(4, '0');
      await db.jobs.create({ id, user_id: 'user', tenant_id: 'tenant', winget_id: 'Vendor.App', version: '1', display_name: 'App', status: 'queued',
        installer_type: 'exe', installer_url: 'https://example.com/test.exe', installer_sha256: 'A'.repeat(64) });
      await db.jobs.update(id, { status: 'failed', error_category: 'approval', created_at: '2026-10-07T00:00:00Z' });
    }
    const first = await db.jobs.getApprovalFailures('tenant', 'Vendor.App');
    const last = first.at(-1)!;
    const next = await db.jobs.getApprovalFailures('tenant', 'Vendor.App', { createdAt: last.created_at, id: last.id });
    expect(first).toHaveLength(100); expect(next).toHaveLength(1);
    expect(new Set([...first, ...next].map(r => r.id)).size).toBe(101);
  });
});
