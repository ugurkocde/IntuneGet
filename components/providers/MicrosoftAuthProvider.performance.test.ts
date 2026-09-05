// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

const state = vi.hoisted(() => {
  const account = { homeAccountId: 'home', localAccountId: 'local', tenantId: 'tenant', username: 'test@example.invalid' };
  const instance = { getActiveAccount: () => null, setActiveAccount: vi.fn(), addEventCallback: vi.fn(() => 'event'), removeEventCallback: vi.fn() };
  return { account, instance, accounts: [] as typeof account[], inProgress: 'startup' };
});
vi.mock('@azure/msal-react', () => ({
  MsalProvider: ({ children }: { children: unknown }) => children,
  useMsal: () => state,
}));
vi.mock('@/lib/msal-config', () => ({ getMsalInstance: () => state.instance }));
vi.mock('@/hooks/useAuthHint', () => ({ notifyAuthHintChanged: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
import { MicrosoftAuthProvider } from './MicrosoftAuthProvider';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('auth provider performance', () => {
  it('keeps descendants mounted during initialization and tracks one event per login', async () => {
    let mounts = 0;
    function Child() { useEffect(() => { mounts++; }, []); return null; }
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const render = () => act(async () => { root.render(createElement(MicrosoftAuthProvider, null, createElement(Child))); });
    try {
      await render();
      state.accounts = [state.account]; state.inProgress = 'none';
      await render();
      await render();
      expect(mounts).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      state.accounts = [];
      await render();
      state.accounts = [state.account];
      await render();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
    }
  });
});
