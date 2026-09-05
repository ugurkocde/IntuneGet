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
});
