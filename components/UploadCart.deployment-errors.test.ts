// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
const mocks = vi.hoisted(() => ({ push: vi.fn(), success: vi.fn(), warning: vi.fn() }));
const auth = vi.hoisted(() => ({
  isAuthenticated: true, user: { id: 'test-user', tenantId: 'test-tenant' },
  getAccessToken: vi.fn().mockResolvedValue('test-token'),
}));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => auth }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: false, selectedTenantId: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning } }));
vi.mock('@/components/AdminConsentBanner', () => ({ clearConsentPending: vi.fn(), isConsentPending: () => false }));
import { UploadCart } from './UploadCart';
import { useCartStore } from '@/stores/cart-store';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { Win32CartItem } from '@/types/upload';

const item: Win32CartItem = {
  id: 'test-app', addedAt: '2026-10-08', appSource: 'win32', wingetId: 'Example.App',
  displayName: 'Example App', publisher: 'Example', version: '1.0', architecture: 'x64', installScope: 'machine',
  installerType: 'msi', installerUrl: 'https://example.test/app.msi', installerSha256: 'a'.repeat(64),
  installCommand: 'install', uninstallCommand: 'uninstall', detectionRules: [], psadtConfig: DEFAULT_PSADT_CONFIG,
};
let root: Root | undefined;
let client: QueryClient | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function deploy(response: Response, entries = [item]) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/package') return response;
    if (url.startsWith('/api/auth/verify-consent')) return Response.json({ verified: true, tenantId: 'test-tenant' });
    return Response.json({ statuses: {}, tenantDeployments: [] });
  }));
  useCartStore.setState({ scope: 'fixture|test-tenant', activeScope: 'fixture|test-tenant', isOpen: true, items: entries });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root!.render(createElement(QueryClientProvider, { client: client! }, createElement(UploadCart))));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const button = [...document.querySelectorAll('button')].find(value => value.textContent?.trim() === 'Deploy to Intune')!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}

describe('deployment result presentation', () => {
  it('shows the fixed failure reason for its app and retains the cart without claiming no Intune changes', async () => {
    await deploy(Response.json({ success: false, jobs: [], errors: [{ wingetId: item.wingetId, error: 'Packaging pipeline not configured' }], message: '0 job(s) processed, 1 failed' }));
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Example App: Packaging pipeline not configured');
    expect(alert.textContent).not.toContain('0 job(s) processed');
    expect(alert.textContent).not.toContain('no changes were made in Intune');
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('does not render upstream response details in the error banner', async () => {
    const privateText = 'Graph errorBody request-id=private-fixture Bearer private-fixture-token';
    await deploy(Response.json({ success: false, jobs: [], errors: [{ wingetId: item.wingetId, error: privateText }], message: privateText }));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Example App: Could not be started');
    expect(document.body.textContent).not.toContain('private-fixture');
  });

  it('retains rejected items and offers progress without a success toast', async () => {
    const rejected = { ...item, id: 'rejected', wingetId: 'Other.App', displayName: 'Other App' };
    await deploy(Response.json({ success: true, jobs: [{ id: 'job-1', package_config: item }], errors: [{ wingetId: rejected.wingetId, error: 'Packaging pipeline not configured' }] }), [item, rejected]);
    expect(useCartStore.getState().items).toEqual([rejected]);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalled();
  });

  it('marks a non-JSON server failure as an unknown outcome', async () => {
    await deploy(new Response('Unavailable', { status: 500, headers: { 'content-type': 'text/plain' } }));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('check Deployments');
    expect(useCartStore.getState().items).toHaveLength(1);
  });
  it('shows the server consent message for a rejected request', async () => {
    await deploy(Response.json({ error: 'Admin consent is required before deployment.' }, { status: 403 }));
    expect(document.body.textContent).toContain('Admin consent is required before deployment.');
    expect(useCartStore.getState().items).toHaveLength(1);
  });

});
