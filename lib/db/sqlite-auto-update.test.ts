import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { sqliteDb as db, closeSqliteDb } from './sqlite';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'intuneget-completion-'));
  process.env.DATABASE_PATH = join(dir, 'test.db');
});
afterEach(() => {
  closeSqliteDb();
  delete process.env.DATABASE_PATH;
  rmSync(dir, { recursive: true, force: true });
});
async function seed() {
  const policy = await db.updatePolicies.upsert({ user_id: 'user', tenant_id: 'tenant', winget_id: 'Vendor.App', policy_type: 'auto_update', consecutive_failures: 2, last_auto_update_version: '2.0', is_enabled: true });
  const job = await db.jobs.create({ user_id: 'user', tenant_id: 'tenant', winget_id: 'Vendor.App', version: '2.0', display_name: 'App', installer_type: 'exe', installer_url: 'https://example.com/app.exe', status: 'packaging', is_auto_update: true, auto_update_policy_id: policy.id, packager_id: 'worker' });
  await db.jobs.update(job.id, { packager_id: 'worker' });
  await db.autoUpdateHistory.create({ policy_id: policy.id, packaging_job_id: job.id, from_version: '1.0', to_version: '2.0', update_type: 'major', status: 'packaging' });
  return { policy, job };
}
describe('SQLite auto-update completion', () => {
  it.each(['deployed', 'duplicate_skipped', 'failed', 'cancelled'] as const)('synchronizes %s exactly once', async status => {
    const { policy, job } = await seed();
    const time = new Date().toISOString();
    for (let i = 0; i < 2; i++) await db.jobs.update(job.id, { status, completed_at: time, error_message: 'test failure' });
    const [history] = await db.autoUpdateHistory.list('user', { limit: 10, offset: 0 });
    const success = status === 'deployed' || status === 'duplicate_skipped';
    expect(history).toMatchObject({ status: success ? 'completed' : status, completed_at: time, error_message: success ? null : 'test failure' });
    expect(await db.updatePolicies.getById(policy.id, 'user')).toMatchObject({ consecutive_failures: success ? 0 : 3, is_enabled: success, last_auto_update_version: success ? '2.0' : null });
  });
  it('does not change history when the ownership condition rejects the job update', async () => {
    const { job } = await seed();
    expect(await db.jobs.update(job.id, { status: 'deployed' }, { packager_id: 'other' })).toBeNull();
    expect((await db.autoUpdateHistory.list('user', { limit: 10, offset: 0 }))[0].status).toBe('packaging');
  });
  it('repairs existing stuck history on startup without counting it twice', async () => {
    const { policy, job } = await seed();
    closeSqliteDb();
    const raw = new Database(process.env.DATABASE_PATH!);
    raw.prepare("UPDATE packaging_jobs SET status = 'failed', completed_at = ? WHERE id = ?").run(new Date().toISOString(), job.id);
    raw.close();
    expect((await db.autoUpdateHistory.list('user', { limit: 10, offset: 0 }))[0].status).toBe('failed');
    closeSqliteDb();
    expect((await db.updatePolicies.getById(policy.id, 'user'))?.consecutive_failures).toBe(1);
  });
  it.each([false, true])('repairs old failures without overwriting a newer attempt: %s', async newerAttempt => {
    const { policy, job } = await seed();
    const jobs = [job];
    for (let i = 0; i < 2; i++) {
      const next = await db.jobs.create({ ...job, id: undefined });
      await db.autoUpdateHistory.create({ policy_id: policy.id, packaging_job_id: next.id, from_version: '1.0', to_version: '2.0', update_type: 'major', status: 'packaging' });
      jobs.push(next);
    }
    await db.updatePolicies.update(policy.id, 'user', { consecutive_failures: 0, last_auto_update_version: newerAttempt ? '3.0' : '2.0' });
    if (newerAttempt) await db.autoUpdateHistory.create({ policy_id: policy.id, from_version: '2.0', to_version: '3.0', update_type: 'major', status: 'packaging', triggered_at: '2099-01-01T00:00:00.000Z' });
    closeSqliteDb();
    const raw = new Database(process.env.DATABASE_PATH!);
    for (const old of jobs) raw.prepare("UPDATE packaging_jobs SET status = 'failed' WHERE id = ?").run(old.id);
    raw.close();
    const history = await db.autoUpdateHistory.list('user', { limit: 10, offset: 0 });
    expect(history.filter(h => h.status === 'failed')).toHaveLength(3);
    expect(await db.updatePolicies.getById(policy.id, 'user')).toMatchObject({ consecutive_failures: newerAttempt ? 0 : 1, is_enabled: true, last_auto_update_version: newerAttempt ? '3.0' : null });
  });
  it('rolls back the job status if tracking cannot be written', async () => {
    const { job } = await seed();
    const raw = new Database(process.env.DATABASE_PATH!);
    raw.exec("CREATE TRIGGER reject_history BEFORE UPDATE ON auto_update_history BEGIN SELECT RAISE(ABORT, 'write failed'); END");
    await expect(db.jobs.update(job.id, { status: 'deployed' })).rejects.toThrow('write failed');
    expect((await db.jobs.getById(job.id))?.status).toBe('packaging');
    expect((await db.autoUpdateHistory.list('user', { limit: 10, offset: 0 }))[0].status).toBe('packaging');
    raw.close();
  });
  it('counts distinct recent workers and excludes expired heartbeats', async () => {
    const { job } = await seed();
    await db.jobs.update(job.id, { packager_heartbeat_at: new Date().toISOString() });
    expect((await db.jobs.getStats()).activePackagers).toBe(1);
    await db.jobs.update(job.id, { packager_heartbeat_at: new Date(Date.now() - 6 * 60 * 1000).toISOString() });
    expect((await db.jobs.getStats()).activePackagers).toBe(0);
  });
});
