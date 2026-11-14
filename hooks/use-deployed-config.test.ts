// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cachedAccount, createMsalTestDouble } from '@/test-utils/msal-test-double';
const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import('@/test-utils/msal-test-double').createMsalTestDouble> }));
vi.mock('@azure/msal-react', () => ({ useMsal: () => state.client.context, useIsAuthenticated: () => state.client.context.accounts.length > 0 }));
vi.mock('@/lib/msal-config', () => ({ graphScopes: ['fixture.read'], getAdminConsentUrl: vi.fn() }));
vi.mock('./useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: false, selectedTenantId: null }) }));
import { useDeployedConfig } from './use-deployed-config';
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let latest: ReturnType<typeof useDeployedConfig>;
const saved = { displayName: 'Saved fixture configuration' };
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
const success = () => response({ config: saved, deployedAt: '2026-01-01T00:00:00Z', intuneAppId: 'fixture-app' });
function Probe() {
  const value = useDeployedConfig('Fixture.App');
  useEffect(() => { latest = value; });
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.client = createMsalTestDouble();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
const render = async () => { await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe)))); await settle(); };
const ready = async () => { const init = state.client.instance.initialize(); state.client.finishInitialization(); await init; };
it('waits for cached account initialization without failing the read or touching account storage', async () => {
  state.client.context.accounts = [cachedAccount];
  const fetch = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => success()); vi.stubGlobal('fetch', fetch);
  await render();
  expect(state.client.instance.getActiveAccount).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(latest.error).toBeNull();
  expect(latest.isPending).toBe(true);
  await ready(); await render();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('/api/intune/apps/deployed/config?wingetId=Fixture.App');
  expect(fetch.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer fixture-token' } });
  expect(latest.deployedConfig).toEqual(saved);
  expect(latest.isPending).toBe(false);
});
it('retries an HTTP failure with the same read and exposes the in-flight state', async () => {
  await ready(); let finish!: (r: Response) => void;
  const fetch = vi.fn().mockResolvedValueOnce(response({ error: 'private server response' }, 500)).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch); await render();
  expect(latest.isError).toBe(true);
  let pending!: ReturnType<typeof latest.refetch>;
  await act(async () => { pending = latest.refetch(); }); await settle();
  expect(latest.isFetching).toBe(true);
  await act(async () => { finish(success()); await pending; }); await settle();
  expect(latest.isError).toBe(false); expect(latest.deployedConfig).toEqual(saved);
  expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
});
it('exposes a cached refetch failure even though the saved configuration remains cached', async () => {
  await ready(); client.setQueryData(['catalog', 'deployed-config', 'Fixture.App', 'self'], { config: saved, intuneAppId: 'fixture-app', deployedAt: null }, { updatedAt: Date.now() - 180000 });
  vi.stubGlobal('fetch', vi.fn(async () => response({}, 503))); await render();
  expect(latest.isError).toBe(true); expect(latest.deployedConfig).toEqual(saved);
});
it('preserves a successful null configuration as a successful read', async () => {
  await ready(); vi.stubGlobal('fetch', vi.fn(async () => response({ config: null, deployedAt: null, intuneAppId: null })));
  await render(); expect(latest.isPending).toBe(false); expect(latest.isError).toBe(false); expect(latest.deployedConfig).toBeNull();
});
