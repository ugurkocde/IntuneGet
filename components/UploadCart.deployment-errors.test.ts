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
const mocks = vi.hoisted(() => ({ push: vi.fn(), success: vi.fn() }));
const auth = vi.hoisted(() => ({
  isAuthenticated: true, user: { id: 'test-user', tenantId: 'test-tenant' },
  getAccessToken: vi.fn().mockResolvedValue('test-token'),
}));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => auth }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: false, selectedTenantId: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));
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

async function deploy(response: Response) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/package') return response;
    if (url.startsWith('/api/auth/verify-consent')) return Response.json({ verified: true, tenantId: 'test-tenant' });
    return Response.json({ statuses: {}, tenantDeployments: [] });
  }));
  useCartStore.setState({ isOpen: true, items: [item] });
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

  it('preserves partial success navigation and clears the cart', async () => {
    await deploy(Response.json({ success: true, jobs: [{ id: 'job-1' }], errors: [{ wingetId: item.wingetId, error: 'Packaging pipeline not configured' }] }));
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(mocks.push).toHaveBeenCalledWith('/dashboard/uploads?jobs=job-1');
    expect(mocks.success).toHaveBeenCalled();
  });

  it('preserves the existing non-JSON HTTP failure', async () => {
    await deploy(new Response('Unavailable', { status: 500, headers: { 'content-type': 'text/plain' } }));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Deployment failed (500)');
    expect(useCartStore.getState().items).toHaveLength(1);
  });
});
