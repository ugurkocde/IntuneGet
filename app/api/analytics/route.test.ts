import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { aggregateDashboardStats } from '@/lib/analytics/dashboard-stats';
const fixture = vi.hoisted(() => ({ jobs: [] as Array<Record<string, unknown>>, read: vi.fn() }));
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => ({ userId: 'report-owner' }) }));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({ jobs: { getByUserId: async () => fixture.jobs.slice(0, 50), getAnalyticsJobs: fixture.read } }) }));
import { GET } from './route';
const job = (id: string, status: string) => ({ id, user_id: 'report-owner', user_email: null, winget_id: 'Example.App', display_name: 'Fixture app', publisher: 'Example', status, error_message: null, created_at: '2026-11-12T08:00:00Z', completed_at: '2026-11-12T09:00:00Z', intune_app_url: null });
const request = (days = 30) => new NextRequest('https://example.test/api/analytics?days=' + days);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T12:00:00Z')); fixture.read.mockReset().mockImplementation(async () => fixture.jobs); fixture.jobs = []; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('uses the same success definition as Overview in totals, daily buckets and top apps', async () => {
 fixture.jobs = [job('a', 'deployed'), job('b', 'completed'), job('c', 'failed')];
 const value = await (await GET(request())).json();
 expect(value.summary).toMatchObject({ completedJobs: 2, failedJobs: 1, successRate: 67 });
 expect(value.dailyDeployments.find((d: { date: string }) => d.date === '2026-11-12')).toMatchObject({ completed: 2, failed: 1 });
 expect(value.topApps).toEqual([{ wingetId: 'Example.App', displayName: 'Fixture app', publisher: 'Example', count: 2 }]);
 const overview = aggregateDashboardStats(fixture.jobs as unknown as Parameters<typeof aggregateDashboardStats>[0], false);
 expect(value.summary.completedJobs).toBe(overview.totalDeployed); expect(value.summary.failedJobs).toBe(overview.failed);
 expect(fixture.read).toHaveBeenCalledWith({ userId: 'report-owner' });
});
it('uses the complete personal analytics collection rather than the fifty item list', async () => {
 fixture.jobs = Array.from({ length: 75 }, (_, i) => job(String(i), 'completed'));
 const value = await (await GET(request())).json();
 expect(value.summary.totalJobs).toBe(75); expect(value.summary.completedJobs).toBe(75);
});
it('keeps UTC buckets consecutive across the local daylight saving boundary', async () => {
 vi.stubEnv('TZ', 'America/Los_Angeles'); vi.setSystemTime(new Date('2026-11-02T00:30:00Z'));
 const value = await (await GET(request(3))).json();
 expect(value.dailyDeployments.map((d: { date: string }) => d.date)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
});
