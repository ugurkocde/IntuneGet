import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let tempDir: string;
beforeEach(() => { vi.resetModules(); tempDir = mkdtempSync(join(tmpdir(), 'approval-checkpoint-')); process.env.DATABASE_PATH = join(tempDir, 'app.db'); });
afterEach(async () => { (await import('@/lib/db/sqlite')).closeSqliteDb(); rmSync(tempDir, { recursive: true, force: true }); delete process.env.DATABASE_PATH; });

describe('SQLite approval checkpoint query', () => {
  it('matches every curated spelling while non-curated IDs stay exact', async () => {
    const { sqliteDb: db } = await import('@/lib/db/sqlite');
    const spellings = ['IntuneGet.Curated.Fixture', 'intuneget.curated.fixture', 'INTUNEGET.CURATED.FIXTURE'];
    for (const [i, app] of [...spellings, 'vendor.app'].entries()) {
      await db.jobs.create({ id: String(i), user_id: 'user', tenant_id: 'tenant', winget_id: app,
        version: '1', display_name: 'Fixture', status: 'queued', installer_type: 'exe',
        installer_url: 'https://example.test/fixture.exe', installer_sha256: 'A'.repeat(64) });
      await db.jobs.update(String(i), { status: 'failed', error_category: 'approval' });
    }
    for (const id of spellings) expect((await db.jobs.getApprovalFailures('tenant', id)).map(r => r.id).sort()).toEqual(['0', '1', '2']);
    expect(await db.jobs.getApprovalFailures('tenant', 'Vendor.App')).toEqual([]);
  });
  it.each(['%', '_', '*', '\\', 'é'])('rejects invalid curated input %s', async suffix => {
    const { sqliteDb: db } = await import('@/lib/db/sqlite');
    await expect(db.jobs.getApprovalFailures('tenant', `IntuneGet.Curated.${suffix}`)).rejects.toThrow('Invalid curated approval checkpoint ID');
  });
  it('includes archived failures from another user and version while excluding unrelated tenant/app/status', async () => {
    const { sqliteDb: db } = await import('@/lib/db/sqlite');
    for (const [id, tenant, app, status, category, code] of [
      ['retained', 'tenant', 'Vendor.App', 'failed', 'approval', null],
      ['coded', 'tenant', 'Vendor.App', 'failed', 'system', 'INTUNE_APPROVAL_REQUIRED'],
      ['cancelled', 'tenant', 'Vendor.App', 'cancelled', 'approval', null],
      ['cancelledCode', 'tenant', 'Vendor.App', 'cancelled', 'system', 'INTUNE_APPROVAL_REQUIRED'],
      ['cancelledOrdinary', 'tenant', 'Vendor.App', 'cancelled', 'network', null],
      ['cancelledOtherTenant', 'other', 'Vendor.App', 'cancelled', 'approval', null],
      ['otherTenant', 'other', 'Vendor.App', 'failed', 'approval', null],
      ['otherApp', 'tenant', 'Vendor.Other', 'failed', 'approval', null],
      ['deployed', 'tenant', 'Vendor.App', 'deployed', 'approval', null],
      ['ordinary', 'tenant', 'Vendor.App', 'failed', 'network', null],
    ]) {
      await db.jobs.create({ id: id!, user_id: 'other-user', tenant_id: tenant!, winget_id: app!, version: 'older', display_name: 'App', status: 'queued',
        installer_type: 'exe', installer_url: 'https://example.com/test.exe', installer_sha256: 'A'.repeat(64) });
      await db.jobs.update(id!, { status: status!, error_category: category, error_code: code, archived_at: new Date().toISOString() });
    }
    expect((await db.jobs.getApprovalFailures('tenant', 'Vendor.App')).map(r => r.id).sort()).toEqual(['cancelled', 'cancelledCode', 'coded', 'retained']);
  });

  it.each([false, true])('reads the next page without skipping equal timestamps (curated %s)', async curated => {
    const { sqliteDb: db } = await import('@/lib/db/sqlite');
    for (let i = 0; i < 101; i++) {
      const id = String(i).padStart(4, '0');
      await db.jobs.create({ id, user_id: 'user', tenant_id: 'tenant', winget_id: curated
        ? (i % 2 ? 'intuneget.curated.fixture' : 'INTUNEGET.CURATED.FIXTURE') : 'Vendor.App', version: '1', display_name: 'App', status: 'queued',
        installer_type: 'exe', installer_url: 'https://example.com/test.exe', installer_sha256: 'A'.repeat(64) });
      await db.jobs.update(id, { status: i % 2 === 0 ? 'failed' : 'cancelled', error_category: 'approval', created_at: '2026-10-07T00:00:00Z' });
    }
    const app = curated ? 'IntuneGet.Curated.Fixture' : 'Vendor.App';
    const first = await db.jobs.getApprovalFailures('tenant', app);
    const last = first.at(-1)!;
    const next = await db.jobs.getApprovalFailures('tenant', app, { createdAt: last.created_at, id: last.id });
    expect(first).toHaveLength(100); expect(next).toHaveLength(1);
    expect(new Set([...first, ...next].map(r => r.id)).size).toBe(101);
  });
});
