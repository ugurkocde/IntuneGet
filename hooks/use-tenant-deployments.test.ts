import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTenantDeployments } from './use-tenant-deployments';

const state = vi.hoisted(() => ({
  token: 'fixture-token' as string | null,
  authenticated: true,
  msp: false,
  tenant: null as string | null,
  data: undefined as { tenantDeployments: { wingetId: string; deployedBy: string | null }[] } | undefined,
  config: null as null | { queryKey: string[]; enabled: boolean; queryFn: () => Promise<unknown> },
}));
vi.mock('./useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ getAccessToken: async () => state.token, isAuthenticated: state.authenticated, user: { tenantId: 'token-tenant' } }) }));
vi.mock('./useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: state.msp, selectedTenantId: state.tenant }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (config: typeof state.config) => { state.config = config; return { data: state.data, isLoading: false, error: null }; } }));

function capture() {
  let value: ReturnType<typeof useTenantDeployments> | undefined;
  function Harness() { value = useTenantDeployments(); return null; }
  renderToStaticMarkup(createElement(Harness));
  return value!;
}

describe('tenant catalog deployment query', () => {
  beforeEach(() => {
    Object.assign(state, { token: 'fixture-token', authenticated: true, msp: false, tenant: null, data: undefined, config: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tenantDeployments: [] }) }));
  });
  it('requests the existing authorized tenant scope with a separate cache key', async () => {
    capture();
    await state.config!.queryFn();
    expect(state.config!.queryKey).toEqual(['catalog', 'deployed', 'tenant', 'token-tenant', 'self']);
    expect(fetch).toHaveBeenCalledWith('/api/intune/apps/deployed?scope=tenant', { headers: { Authorization: 'Bearer fixture-token' } });
  });
  it('binds the selected MSP tenant in both request and cache key', async () => {
    Object.assign(state, { msp: true, tenant: 'fixture-tenant' });
    capture(); await state.config!.queryFn();
    expect(state.config!.queryKey.at(-1)).toBe('fixture-tenant');
    expect(fetch).toHaveBeenCalledWith(expect.any(String), { headers: { Authorization: 'Bearer fixture-token', 'X-MSP-Tenant-Id': 'fixture-tenant' } });
    state.tenant = 'other-fixture-tenant'; capture();
    expect(state.config!.queryKey.at(-1)).toBe('other-fixture-tenant');
  });
  it('does not enable an unauthenticated query and refuses an absent token', async () => {
    Object.assign(state, { authenticated: false, token: null }); capture();
    expect(state.config!.enabled).toBe(false);
    await expect(state.config!.queryFn()).rejects.toThrow('Not authenticated');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains the server authorization error rather than treating it as a deployment', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Tenant access denied' }) } as Response);
    capture(); await expect(state.config!.queryFn()).rejects.toThrow('Tenant access denied');
  });
  it('distinguishes a deployed package without attribution from an absent package', () => {
    state.data = { tenantDeployments: [{ wingetId: 'Fixture.App', deployedBy: null }] };
    const result = capture();
    expect(result.tenantDeployments.get('Fixture.App')).toBeNull();
    expect(result.tenantDeployments.get('Other.App')).toBeUndefined();
  });
});
