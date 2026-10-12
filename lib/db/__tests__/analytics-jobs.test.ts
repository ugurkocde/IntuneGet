import { describe, expect, it, vi } from 'vitest';
vi.stubEnv('DATABASE_PATH', ':memory:');
import { sqliteDb } from '../sqlite';
describe('real SQLite analytics reads', () => {
  it('counts complete personal activity, isolates the tenant and excludes archived rows', async () => {
    for (let i = 0; i < 61; i++) await sqliteDb.jobs.create({ id: `analytics-${i}`, user_id: 'anna', tenant_id: i === 60 ? 'other' : 'shared', winget_id: 'Example.App', version: '1', display_name: 'Example', installer_type: 'exe', installer_url: 'https://example.invalid/app.exe', status: 'deployed' });
    await sqliteDb.jobs.create({ id: 'analytics-bob', user_id: 'bob', tenant_id: 'shared', winget_id: 'Example.App', version: '1', display_name: 'Example', installer_type: 'exe', installer_url: 'https://example.invalid/app.exe', status: 'failed' });
    await sqliteDb.jobs.update('analytics-0', { archived_at: '2026-10-10T00:00:00Z' });
    const personal = await sqliteDb.jobs.getAnalyticsJobs({ userId: 'anna' });
    const tenant = await sqliteDb.jobs.getAnalyticsJobs({ tenantId: 'shared' });
    expect(personal).toHaveLength(60); expect(tenant).toHaveLength(60);
    expect(personal.every(row => row.user_id === 'anna')).toBe(true);
    expect(tenant.some(row => row.id === 'analytics-60')).toBe(false);
    expect(tenant.some(row => row.id === 'analytics-bob')).toBe(true);
    expect(tenant.some(row => row.id === 'analytics-0')).toBe(false);
    expect(personal[0]).not.toHaveProperty('installer_url');
  });
});
