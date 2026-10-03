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
const auth = vi.hoisted(() => ({
  isAuthenticated: true, user: { id: 'user', tenantId: 'tenant' },
  getAccessToken: vi.fn().mockResolvedValue('test-token'),
}));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => auth }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: false, selectedTenantId: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/AdminConsentBanner', () => ({ clearConsentPending: vi.fn(), isConsentPending: () => false }));
import { UploadCart } from './UploadCart';
import { useCartStore } from '@/stores/cart-store';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { Win32CartItem } from '@/types/upload';

let root: Root | undefined;
let client: QueryClient | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('cart permission verification', () => {
  it('does not refetch negative permission responses on checking/error transitions', async () => {
    const fetchMock = vi.fn(async () => Response.json({ verified: false, tenantId: 'tenant', error: 'consent_propagating', message: 'Waiting' }));
    vi.stubGlobal('fetch', fetchMock);
    useCartStore.setState({ isOpen: true, items: [] });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
    await act(async () => { root!.render(createElement(QueryClientProvider, { client: client! }, createElement(UploadCart))); });
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[aria-labelledby="cart-title"]')).toHaveLength(1);
    await act(async () => { useCartStore.setState({ isOpen: false }); });
    await act(async () => { useCartStore.setState({ isOpen: true }); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offers recovery for a removed version, prevents repeated deployment, and unblocks the remaining cart after removal', async () => {
    const item: Win32CartItem = {
      id: 'old-chrome', addedAt: '2026-07-09', appSource: 'win32', wingetId: 'Google.Chrome',
      displayName: 'Google Chrome', publisher: 'Google', version: '150.0.7871.115', architecture: 'x64', installScope: 'machine',
      installerType: 'msi', installerUrl: 'https://example.test/chrome.msi', installerSha256: 'A'.repeat(64),
      installCommand: 'install', uninstallCommand: 'uninstall', detectionRules: [], psadtConfig: DEFAULT_PSADT_CONFIG,
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/package') return Response.json({
        code: 'MANIFEST_UNAVAILABLE', retryable: false, message: 'Review the current version.',
        package: { wingetId: item.wingetId, displayName: item.displayName, version: item.version },
      }, { status: 409 });
      if (url.startsWith('/api/auth/verify-consent')) return Response.json({ verified: true, tenantId: 'tenant' });
      if (url.startsWith('/api/winget/manifest')) return Response.json({
        manifest: { id: item.wingetId, version: '154.0.8037.98' }, installers: [], versions: ['154.0.8037.98'],
      });
      return Response.json({ statuses: {}, tenantDeployments: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    useCartStore.setState({ isOpen: true, items: [item, { ...item, id: 'other', wingetId: 'Other.App', displayName: 'Other App' }] });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
    await act(async () => root!.render(createElement(QueryClientProvider, { client: client! }, createElement(UploadCart))));
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    const button = (text: string) => [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === text)!;
    expect(document.body.textContent).not.toContain('Ready to deploy');
    expect(document.body.textContent).toContain('Intune permissions verified');
    await act(async () => button('Deploy to Intune').click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Selected version is no longer available');
    expect(button('Deploy to Intune').disabled).toBe(true);
    expect(button('Review current version')).toBeDefined();
    await act(async () => button('Review current version').click());
    expect(fetchMock).toHaveBeenCalledWith('/api/winget/manifest?id=Google.Chrome', expect.any(Object));
    expect(useCartStore.getState().items[0].version).toBe(item.version);
    await act(async () => button('Remove unavailable app').click());
    expect(useCartStore.getState().items.map(value => value.id)).toEqual(['other']);
    expect(button('Deploy to Intune').disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/package')).toHaveLength(1);
  });
});
