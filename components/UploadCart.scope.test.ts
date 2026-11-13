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
const mocks = vi.hoisted(() => ({ push: vi.fn(), success: vi.fn(), error: vi.fn() }));
const auth = vi.hoisted(() => ({
  isAuthenticated: true, user: { id: 'test-user', tenantId: 'test-tenant' },
  getAccessToken: vi.fn().mockResolvedValue('test-token'),
}));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => auth }));
const msp = vi.hoisted(() => ({ isMspUser: false, selectedTenantId: null as string | null, selectedTenant: null as { display_name: string } | null }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => msp }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
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
  Object.assign(msp, { isMspUser: false, selectedTenantId: null, selectedTenant: null });
});

async function mountCart(response: Response | Promise<Response>, state: Record<string, unknown> = {}) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/package') return response;
    if (url.startsWith('/api/auth/verify-consent')) return Response.json({ verified: true, tenantId: 'test-tenant' });
    return Response.json({ statuses: {}, tenantDeployments: [] });
  }));
  useCartStore.setState({ isOpen: true, items: [item], scope: 'account|test-tenant', activeScope: 'account|test-tenant', ...state } as never);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root!.render(createElement(QueryClientProvider, { client: client! }, createElement(UploadCart))));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const button = [...document.querySelectorAll('button')].find(value => value.textContent?.trim() === 'Deploy to Intune')!;
  return button;
}


it('does not deploy a cart from another account or tenant', async () => {
 const b = await mountCart(Response.json({ success: true, jobs: [{ id: 'job' }] }), { activeScope: 'other|test-tenant' });
 if (b) await act(async () => b.click());
 expect(vi.mocked(fetch).mock.calls.filter(([url, opts]) => url === '/api/package' && opts?.method === 'POST')).toHaveLength(0);
 expect(document.body.textContent).not.toContain('Example App');
});
it('refuses the old cart when its tenant changes while acquiring a token', async () => {
 const b = await mountCart(Response.json({ success: true, jobs: [{ id: 'job' }] }));
 let resolve!: (v: string) => void; auth.getAccessToken.mockImplementationOnce(() => new Promise<string>(r => { resolve = r; }));
 await act(async () => b.click());
 await act(async () => useCartStore.setState({ items: [], scope: 'account|other-tenant', activeScope: 'account|other-tenant' } as never));
 await act(async () => resolve('fixture-token'));
 expect(vi.mocked(fetch).mock.calls.filter(([url, opts]) => url === '/api/package' && opts?.method === 'POST')).toHaveLength(0);
});

it('does not clear the new tenant cart when an earlier request completes', async () => {
 let resolve!: (response: Response) => void;
 const pending = new Promise<Response>(r => { resolve = r; }); const b = await mountCart(pending);
 await act(async () => b.click());
 const nextItem = { ...item, id: 'new-tenant-item', displayName: 'New tenant app' };
 await act(async () => useCartStore.setState({ items: [nextItem], scope: 'account|other-tenant', activeScope: 'account|other-tenant' } as never));
 await act(async () => resolve(Response.json({ success: true, jobs: [{ id: 'earlier-job' }] })));
 expect(useCartStore.getState().items.map(i => i.id)).toEqual(['new-tenant-item']); expect(mocks.success).not.toHaveBeenCalled();
});

it('names the MSP destination in the heading and large cart confirmation', async () => {
 Object.assign(msp, { isMspUser: true, selectedTenantId: 'test-tenant', selectedTenant: { display_name: 'Customer Fixture' } });
 const b = await mountCart(Response.json({ success: true, jobs: [{ id: 'job' }] }), { items: Array.from({length:10},(_,i)=>({...item,id:'fixture-'+i})) });
 expect(document.body.textContent).toContain('Destination: Customer Fixture'); await act(async()=>b.click());
 expect(document.body.textContent).toContain('Deploy 10 apps to Customer Fixture?');
});
