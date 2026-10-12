import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'intuneget-db-'));
  process.env.DATABASE_PATH = join(tempDir, 'app.db');
});

afterEach(async () => {
  const { closeSqliteDb } = await import('@/lib/db/sqlite');
  closeSqliteDb();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATABASE_PATH;
});

async function loadAdapter() {
  const { sqliteDb } = await import('@/lib/db/sqlite');
  return sqliteDb;
}

describe('sqlite update policies', () => {
  it('upserts on the user, tenant, app key and reads by id and key', async () => {
    const db = await loadAdapter();
    const created = await db.updatePolicies.upsert({
      user_id: 'u1',
      tenant_id: 't1',
      winget_id: 'Vendor.App',
      policy_type: 'notify',
    });

    expect(created.id).toBeTruthy();
    expect(created.is_enabled).toBe(true);

    const byKey = await db.updatePolicies.getByKey('u1', 't1', 'Vendor.App');
    expect(byKey?.id).toBe(created.id);
    expect(await db.updatePolicies.getById(created.id, 'u1')).toMatchObject({ policy_type: 'notify' });
    expect(await db.updatePolicies.getById(created.id, 'u2')).toBeNull();

    const upserted = await db.updatePolicies.upsert({
      user_id: 'u1',
      tenant_id: 't1',
      winget_id: 'Vendor.App',
      policy_type: 'ignore',
    });
    expect(upserted.id).toBe(created.id);
    expect((await db.updatePolicies.list('u1'))[0].policy_type).toBe('ignore');
  });

  it('scopes list to the user and optional tenant', async () => {
    const db = await loadAdapter();
    await db.updatePolicies.upsert({ user_id: 'u1', tenant_id: 't1', winget_id: 'A.One', policy_type: 'notify' });
    await db.updatePolicies.upsert({ user_id: 'u1', tenant_id: 't2', winget_id: 'A.Two', policy_type: 'notify' });
    await db.updatePolicies.upsert({ user_id: 'u2', tenant_id: 't1', winget_id: 'A.One', policy_type: 'notify' });

    expect(await db.updatePolicies.list('u1')).toHaveLength(2);
    expect(await db.updatePolicies.list('u1', 't1')).toHaveLength(1);
    expect(await db.updatePolicies.list('u2')).toHaveLength(1);
  });

  it('updates and deletes only the owning user rows', async () => {
    const db = await loadAdapter();
    const policy = await db.updatePolicies.upsert({
      user_id: 'u1',
      tenant_id: 't1',
      winget_id: 'Vendor.App',
      policy_type: 'notify',
    });

    const updated = await db.updatePolicies.update(policy.id, 'u1', {
      policy_type: 'ignore',
      is_enabled: false,
    });
    expect(updated).toMatchObject({ policy_type: 'ignore', is_enabled: false });

    expect(await db.updatePolicies.update(policy.id, 'u2', { policy_type: 'notify' })).toBeNull();
    expect(await db.updatePolicies.delete(policy.id, 'u2')).toBe(false);
    expect(await db.updatePolicies.delete(policy.id, 'u1')).toBe(true);
    expect(await db.updatePolicies.list('u1')).toHaveLength(0);
  });
});

describe('sqlite upload history lookup', () => {
  it('returns the newest deployment for one app, filtered in the query', async () => {
    const db = await loadAdapter();
    await db.uploadHistory.create({ user_id: 'u1', winget_id: 'A.One', version: '1.0.0', display_name: 'One', intune_app_id: 'a1', intune_tenant_id: 't1', deployed_at: '2026-01-01T00:00:00.000Z' });
    await db.uploadHistory.create({ user_id: 'u1', winget_id: 'A.One', version: '1.1.0', display_name: 'One', intune_app_id: 'a1', intune_tenant_id: 't1', deployed_at: '2026-02-01T00:00:00.000Z' });
    await db.uploadHistory.create({ user_id: 'u1', winget_id: 'A.Two', version: '9.0.0', display_name: 'Two', intune_app_id: 'a2', intune_tenant_id: 't1' });

    expect((await db.uploadHistory.getLatest('u1', 't1', 'A.One'))?.version).toBe('1.1.0');
    expect((await db.uploadHistory.getLatest('u1', 't1', 'A.Two'))?.version).toBe('9.0.0');
    expect(await db.uploadHistory.getLatest('u1', 't2', 'A.One')).toBeNull();
  });
});

describe('sqlite update check results', () => {
  it('upserts, lists with filters, dismisses, and deletes rows that are no longer current', async () => {
    const db = await loadAdapter();
    const base = {
      user_id: 'u1',
      tenant_id: 't1',
      winget_id: 'Vendor.App',
      intune_app_id: 'app-1',
      display_name: 'Vendor App',
      current_version: '1.0.0',
      latest_version: '1.1.0',
    };

    const created = await db.updateCheckResults.upsert(base);
    expect(created.is_managed).toBe(true);
    expect(created.is_critical).toBe(false);

    const refreshed = await db.updateCheckResults.upsert({ ...base, current_version: '1.0.1' });
    expect(refreshed.id).toBe(created.id);
    expect(refreshed.current_version).toBe('1.0.1');

    expect(await db.updateCheckResults.list('u1', {})).toHaveLength(1);
    expect(await db.updateCheckResults.list('u1', { tenantId: 't2' })).toHaveLength(0);
    expect(await db.updateCheckResults.list('u1', { criticalOnly: true })).toHaveLength(0);

    expect(await db.updateCheckResults.setDismissed([created.id], 'u1', new Date().toISOString())).toBe(1);
    expect(await db.updateCheckResults.list('u1', {})).toHaveLength(0);
    expect(await db.updateCheckResults.list('u1', { includeDismissed: true })).toHaveLength(1);

    await db.updateCheckResults.upsert({ ...base, winget_id: 'Vendor.Other', intune_app_id: 'app-2' });
    const removed = await db.updateCheckResults.deleteMissing('u1', 't1', [
      { wingetId: 'Vendor.App', intuneAppId: 'app-1' },
    ]);
    expect(removed).toBe(1);
    expect(await db.updateCheckResults.list('u1', { includeDismissed: true })).toHaveLength(1);
  });
});

describe('sqlite fleet and rate-limit helpers', () => {
  it('lists all deployments, policies, and counts history for policies', async () => {
    const db = await loadAdapter();
    await db.uploadHistory.create({ user_id: 'u1', winget_id: 'A', version: '1.0.0', display_name: 'A', intune_app_id: 'a1', intune_tenant_id: 't1' });
    await db.uploadHistory.create({ user_id: 'u2', winget_id: 'B', version: '1.0.0', display_name: 'B', intune_app_id: 'b1', intune_tenant_id: 't2' });
    expect(await db.uploadHistory.listAll()).toHaveLength(2);

    const policy = await db.updatePolicies.upsert({ user_id: 'u1', tenant_id: 't1', winget_id: 'A', policy_type: 'auto_update' });
    expect(await db.updatePolicies.listAll()).toHaveLength(1);

    await db.autoUpdateHistory.create({ policy_id: policy.id, from_version: '1.0.0', to_version: '1.1.0', update_type: 'minor', status: 'completed' });
    const since = '2000-01-01T00:00:00.000Z';
    expect(await db.autoUpdateHistory.countForPolicies([policy.id], since)).toBe(1);
    expect(await db.autoUpdateHistory.countForPolicies([policy.id], since, 'completed')).toBe(1);
    expect(await db.autoUpdateHistory.countForPolicies([policy.id], since, 'failed')).toBe(0);
    expect(await db.autoUpdateHistory.countForPolicies([], since)).toBe(0);
  });
});

describe('sqlite auto update history', () => {
  it('creates, updates, and lists history joined with the policy target', async () => {
    const db = await loadAdapter();
    const policy = await db.updatePolicies.upsert({
      user_id: 'u1',
      tenant_id: 't1',
      winget_id: 'Vendor.App',
      policy_type: 'auto_update',
    });

    const history = await db.autoUpdateHistory.create({
      policy_id: policy.id,
      from_version: '1.0.0',
      to_version: '1.1.0',
      update_type: 'minor',
    });
    expect(history.status).toBe('pending');

    const completed = await db.autoUpdateHistory.update(history.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    expect(completed?.status).toBe('completed');

    const listed = await db.autoUpdateHistory.list('u1', { limit: 50, offset: 0 });
    expect(listed).toHaveLength(1);
    expect(listed[0].policy).toEqual({ winget_id: 'Vendor.App', tenant_id: 't1' });
    expect(listed[0].from_version).toBe('1.0.0');

    expect(await db.autoUpdateHistory.list('u2', { limit: 50, offset: 0 })).toHaveLength(0);
  });

  it('filters history by tenant, app, and status and paginates', async () => {
    const db = await loadAdapter();
    const policy = await db.updatePolicies.upsert({
      user_id: 'u1',
      tenant_id: 't1',
      winget_id: 'Vendor.App',
      policy_type: 'auto_update',
    });
    const other = await db.updatePolicies.upsert({
      user_id: 'u1',
      tenant_id: 't2',
      winget_id: 'Vendor.Other',
      policy_type: 'auto_update',
    });

    await db.autoUpdateHistory.create({ policy_id: policy.id, from_version: '1.0.0', to_version: '2.0.0', update_type: 'major', status: 'failed' });
    await db.autoUpdateHistory.create({ policy_id: policy.id, from_version: '1.0.0', to_version: '1.0.1', update_type: 'patch', status: 'completed' });
    await db.autoUpdateHistory.create({ policy_id: other.id, from_version: '3.0.0', to_version: '3.1.0', update_type: 'minor', status: 'completed' });

    expect(await db.autoUpdateHistory.list('u1', { limit: 50, offset: 0 })).toHaveLength(3);
    expect(await db.autoUpdateHistory.list('u1', { tenantId: 't1', limit: 50, offset: 0 })).toHaveLength(2);
    expect(await db.autoUpdateHistory.list('u1', { wingetId: 'Vendor.Other', limit: 50, offset: 0 })).toHaveLength(1);
    expect(await db.autoUpdateHistory.list('u1', { status: 'failed', limit: 50, offset: 0 })).toHaveLength(1);
    expect(await db.autoUpdateHistory.list('u1', { limit: 1, offset: 1 })).toHaveLength(1);
  });
});
