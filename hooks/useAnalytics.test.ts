import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn(options => options) }));
vi.mock('./useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ isAuthenticated: true, user: { id: 'caller', tenantId: 'primary' }, getAccessToken: async () => 'test-token' }) }));
vi.mock('./useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: true, selectedTenantId: 'selected-customer' }) }));
import { useDashboardStats } from './useAnalytics';
beforeEach(() => vi.clearAllMocks());
describe('dashboard scope query', () => {
  it('defaults to personal and uses an identity-bound cache key', () => { useDashboardStats(); expect(vi.mocked(useQuery).mock.calls[0][0].queryKey).toEqual(['analytics', 'stats', 'mine', 'personal', 'caller']); });
  it('sends the selected customer only in tenant mode', async () => { const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }); vi.stubGlobal('fetch', fetcher); useDashboardStats('tenant'); const options = vi.mocked(useQuery).mock.calls[0][0]; expect(options.queryKey).toEqual(['analytics', 'stats', 'tenant', 'selected-customer', 'caller']); const queryFn = options.queryFn; if (typeof queryFn !== 'function') throw Error('Query function missing'); await queryFn({} as Parameters<typeof queryFn>[0]); expect(fetcher).toHaveBeenCalledWith('/api/analytics/stats?scope=tenant', { headers: { Authorization: 'Bearer test-token', 'X-MSP-Tenant-Id': 'selected-customer' } }); vi.unstubAllGlobals(); });
  it('polls the tenant no faster than once per minute', () => { useDashboardStats('tenant'); const interval = vi.mocked(useQuery).mock.calls[0][0].refetchInterval; if (typeof interval !== 'function') throw Error('Interval function missing'); expect(interval({ state: { data: { pending: 1 } } } as Parameters<typeof interval>[0])).toBe(60000); });
});
