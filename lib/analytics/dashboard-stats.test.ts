import { describe, expect, it } from 'vitest';
import { aggregateDashboardStats } from './dashboard-stats';
import { collectAnalyticsJobs } from './complete-job-pages';
import type { AnalyticsJob } from '@/lib/db/types';
const row = (id: string, status = 'deployed', completed_at: string | null = '2026-10-01T00:00:00Z'): AnalyticsJob => ({ id, user_id: 'user', user_email: null, status, completed_at, created_at: '2026-10-01T00:00:00Z', winget_id: 'Example.App', display_name: 'Example', intune_app_url: null });
describe('statistics aggregation', () => {
  it('preserves completion semantics and excludes cancellation from pending', () => { const v = aggregateDashboardStats(['deployed', 'completed', 'queued', 'packaging', 'uploading', 'failed', 'cancelled'].map((s, i) => row(String(i), s)), true, new Date('2026-10-10')); expect(v).toMatchObject({ totalDeployed: 2, thisMonth: 2, pending: 3, failed: 1, perUser: [{ userEmail: 'Unknown user', deployed: 2, pending: 3, failed: 1 }] }); });
  it('uses UTC month boundaries and rejects future month/invalid dates', () => { const v = aggregateDashboardStats([row('before', 'deployed', '2026-09-30T23:59:59Z'), row('now'), row('next', 'deployed', '2026-11-01T00:00:00Z'), row('bad', 'deployed', 'invalid')], false, new Date('2026-10-10')); expect(v.totalDeployed).toBe(4); expect(v.thisMonth).toBe(1); });
});
describe('complete statistics pagination', () => {
  it('handles a server row limit below the requested page size', async () => { const source = Array.from({ length: 1101 }, (_, i) => row(String(i))); const offsets: number[] = []; const result = await collectAnalyticsJobs(async offset => { offsets.push(offset); return { data: source.slice(offset, offset + 500), count: source.length }; }); expect(result).toHaveLength(1101); expect(offsets).toEqual([0, 500, 1000]); });
  it('accepts a complete empty collection', async () => { expect(await collectAnalyticsJobs(async () => ({ data: [], count: 0 }))).toEqual([]); });
  it.each([null, -1, 0.5, 100001])('rejects invalid or excessive count %s', async count => { await expect(collectAnalyticsJobs(async () => ({ data: [], count }))).rejects.toThrow(); });
  it('rejects truncated pages and changed counts', async () => { await expect(collectAnalyticsJobs(async () => ({ data: [], count: 2 }))).rejects.toThrow(); let n = 0; await expect(collectAnalyticsJobs(async () => ({ data: [row(String(n++))], count: n === 1 ? 2 : 3 }))).rejects.toThrow(); });
  it('rejects duplicated rows instead of double counting or claiming completeness', async () => { await expect(collectAnalyticsJobs(async () => ({ data: [row('same')], count: 2 }))).rejects.toThrow('changed during pagination'); });
});
