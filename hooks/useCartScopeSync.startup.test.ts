// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createMsalTestDouble } from '@/test-utils/msal-test-double';

const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import('@/test-utils/msal-test-double').createMsalTestDouble> }));
vi.mock('@azure/msal-react', () => ({
  useMsal: () => state.client.context,
  useIsAuthenticated: () => state.client.context.accounts.length > 0,
}));
vi.mock('@/lib/msal-config', () => ({ graphScopes: ['fixture.read'], getAdminConsentUrl: vi.fn() }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: false, isLoadingOrganization: false, isLoadingTenants: false, selectedTenantId: null }) }));
import { useCartScopeSync } from './useCartScopeSync';
import { useCartStore } from '@/stores/cart-store';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
it('waits for MSAL initialization before binding a returning user cart', async () => {
  state.client = createMsalTestDouble();
  useCartStore.setState({ items: [], scope: null, activeScope: null });
  function Probe() { useCartScopeSync(); return null; }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(state.client.instance.getActiveAccount).not.toHaveBeenCalled();
    expect(useCartStore.getState().scope).toBeNull();
    const initialization = state.client.instance.initialize();
    state.client.finishInitialization();
    await initialization;
    await act(async () => root.render(createElement(Probe)));
    expect(useCartStore.getState().activeScope).toBe('home-a|tenant-a');
    expect(useCartStore.getState().scope).toBe('home-a|tenant-a');
  } finally {
    await act(async () => root.unmount()); host.remove();
    useCartStore.setState({ items: [], scope: null, activeScope: null });
  }
});
