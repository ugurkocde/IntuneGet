import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ token: null as string | null, query: null as ((context?: { pageParam: number }) => Promise<unknown>) | null }));
vi.mock('./useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ isAuthenticated: true, getAccessToken: async () => state.token }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryFn: typeof state.query }) => { state.query = options.queryFn; return {}; },
  useInfiniteQuery: (options: { queryFn: typeof state.query }) => { state.query = options.queryFn; return {}; },
  useMutation: vi.fn(), useQueryClient: vi.fn(),
}));
import { useAvailableUpdates, useAutoUpdateHistory, useUpdatePolicies } from './use-updates';

beforeEach(() => { state.token = null; state.query = null; vi.unstubAllGlobals(); });
it.each([useAvailableUpdates, useAutoUpdateHistory, useUpdatePolicies])('rejects an unchecked query without a session: %s', async hook => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  hook();
  await expect(state.query!({ pageParam: 0 })).rejects.toThrow(/auth|session|sign in/i);
  expect(fetch).not.toHaveBeenCalled();
});
it('still returns a genuinely successful empty update response with the existing token header', async () => {
  state.token = 'fixture-only';
  const fetch = vi.fn().mockResolvedValue(Response.json({ updates: [], count: 0, criticalCount: 0 }));
  vi.stubGlobal('fetch', fetch); useAvailableUpdates();
  expect(await state.query!()).toEqual({ updates: [], count: 0, criticalCount: 0 });
  expect(fetch).toHaveBeenCalledWith('/api/updates/available', { headers: { Authorization: 'Bearer fixture-only' } });
});
