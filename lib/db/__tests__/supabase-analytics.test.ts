import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ pages: [] as Array<{ data: unknown[] | null; count: number | null; error: { message: string; code?: string } | null }>, filters: [] as Array<[string, string]>, archiveCalls: 0, ranges: [] as Array<[number, number]> }));
vi.mock('@/lib/supabase', () => ({ createServerClient: () => ({ from: () => {
  const q = { select: () => q, eq: (k: string, v: string) => { state.filters.push([k, v]); return q; }, is: () => { state.archiveCalls++; return q; }, order: () => q, range: (a: number, b: number) => { state.ranges.push([a, b]); return q; }, abortSignal: () => Promise.resolve(state.pages.shift()) };
  return q;
} }) }));
import { supabaseDb } from '../supabase-adapter';
beforeEach(() => { state.pages = []; state.filters = []; state.archiveCalls = 0; state.ranges = []; });
describe('hosted statistics paging and schema compatibility', () => {
  it('binds tenant reads and completes pages below the service page size', async () => { state.pages = [{ data: [{ id: 'a' }], count: 2, error: null }, { data: [{ id: 'b' }], count: 2, error: null }]; expect(await supabaseDb.jobs.getAnalyticsJobs({ tenantId: 'shared' })).toHaveLength(2); expect(state.filters).toEqual([['tenant_id', 'shared'], ['tenant_id', 'shared']]); expect(state.ranges).toEqual([[0, 999], [1, 1000]]); });
  it('keeps old database support when archived_at is missing', async () => { state.pages = [{ data: null, count: null, error: { message: 'column packaging_jobs.archived_at does not exist', code: '42703' } }, { data: [{ id: 'mine' }], count: 1, error: null }]; expect(await supabaseDb.jobs.getAnalyticsJobs({ userId: 'caller' })).toHaveLength(1); expect(state.archiveCalls).toBe(1); expect(state.filters.every(([k, v]) => k === 'user_id' && v === 'caller')).toBe(true); });
  it('propagates read failure without returning partial records', async () => { state.pages = [{ data: null, count: null, error: { message: 'timeout' } }]; await expect(supabaseDb.jobs.getAnalyticsJobs({ tenantId: 'shared' })).rejects.toThrow(); });
});
