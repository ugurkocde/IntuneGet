// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { cachedAccount, createMsalTestDouble } from '@/test-utils/msal-test-double';

const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import('@/test-utils/msal-test-double').createMsalTestDouble> }));
vi.mock('@azure/msal-react', () => ({
  MsalProvider: ({ children }: { children: unknown }) => children,
  useMsal: () => state.client.context,
}));
vi.mock('@/lib/msal-config', () => ({ getMsalInstance: () => state.client.instance }));
vi.mock('@/hooks/useAuthHint', () => ({ notifyAuthHintChanged: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
import { MicrosoftAuthProvider } from './MicrosoftAuthProvider';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('auth provider performance', () => {
  it('keeps descendants mounted during initialization and tracks one event per login', async () => {
    state.client = createMsalTestDouble();
    let mounts = 0;
    function Child() { useEffect(() => { mounts++; }, []); return null; }
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const render = () => act(async () => { root.render(createElement(MicrosoftAuthProvider, null, createElement(Child))); });
    try {
      await render();
      expect(state.client.instance.getActiveAccount).not.toHaveBeenCalled();
      const initialization = state.client.instance.initialize();
      state.client.finishInitialization();
      await initialization;
      await render();
      await render();
      expect(mounts).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      state.client.context.accounts = [];
      state.client.instance.setActiveAccount(null);
      await render();
      state.client.context.accounts = [cachedAccount];
      state.client.instance.setActiveAccount(cachedAccount);
      await render();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
    }
  });
});
