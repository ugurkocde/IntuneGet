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
const mocks = vi.hoisted(() => ({ push: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
const auth = vi.hoisted(() => ({
  isAuthenticated: true, user: { id: 'test-user', tenantId: 'test-tenant' },
  getAccessToken: vi.fn().mockResolvedValue('test-token'),
}));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => auth }));
const msp = vi.hoisted(() => ({ isMspUser: false, selectedTenantId: null as string | null, selectedTenant: null as { display_name: string } | null }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => msp }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
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

async function mountCart(response: (items: Win32CartItem[]) => Response | Promise<Response>, state: Record<string, unknown> = {}) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/package') return response(JSON.parse(String(init?.body)).items);
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


const started = (batch: Win32CartItem[]) => Response.json({ success: true, jobs: batch.map(value => ({ id: 'job-' + value.id, winget_id: value.wingetId, package_config: value })) });
async function clickDeploy(button: HTMLButtonElement) {
 await act(async () => button.click());
 const confirm = [...document.querySelectorAll('button')].find(value => value.textContent?.trim() === 'Deploy All');
 if (confirm) await act(async () => confirm.click());
}
const many = (count: number) => Array.from({ length: count }, (_, i) => ({ ...item, id: 'item-' + i, wingetId: 'Fixture.App' + i, displayName: 'Fixture app ' + i }));
it('sends 25 apps as sequential batches of 10,10,5 with the same tenant', async () => {
 Object.assign(msp, { isMspUser: true, selectedTenantId: 'test-tenant', selectedTenant: { display_name: 'Fixture organization' } });
 const button = await mountCart(started, { items: many(25) }); await clickDeploy(button);
 const calls = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/package');
 expect(calls.map(([, init]) => JSON.parse(String(init?.body)).items.length)).toEqual([10,10,5]);
 expect(calls.every(([, init]) => (init?.headers as Record<string,string>)['X-MSP-Tenant-Id'] === 'test-tenant')).toBe(true);
 expect(useCartStore.getState().items).toHaveLength(0);
});
it('retains the rejected version when another version of the same app starts', async () => {
 const entries = [item, { ...item, id: 'other-version', version: '2.0' }];
 const button = await mountCart(batch => Response.json({ success: true, jobs: [{ id: 'job', package_config: batch[0] }], errors: [{ wingetId: item.wingetId, error: 'Packaging pipeline not configured' }] }), { items: entries });
 await clickDeploy(button); expect(useCartStore.getState().items).toEqual([entries[1]]);
 expect(mocks.success).not.toHaveBeenCalled(); expect(mocks.warning).toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
});
it('stops after an unknown second batch and preserves its fifteen unsent or uncertain items', async () => {
 let requests = 0; const button = await mountCart(batch => ++requests === 1 ? started(batch) : new Response('Unavailable', { status: 500 }), { items: many(25) });
 await clickDeploy(button); expect(requests).toBe(2); expect(useCartStore.getState().items).toHaveLength(15);
 expect(document.body.textContent).toContain('check Deployments'); expect(mocks.success).not.toHaveBeenCalled(); expect(mocks.warning).toHaveBeenCalled();
});
it('never sends a later batch or alters a new tenant cart after a scope switch', async () => {
 let resolve!: (value: Response) => void; const entries = many(25);
 const button = await mountCart(() => new Promise<Response>(r => { resolve = r; }), { items: entries }); await clickDeploy(button);
 await act(async () => useCartStore.setState({ items: [{ ...item, id: 'new-tenant-item' }], scope: 'account|other-tenant', activeScope: 'account|other-tenant' }));
 await act(async () => resolve(started(entries.slice(0,10))));
 expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/package')).toHaveLength(1);
 expect(useCartStore.getState().items.map(value => value.id)).toEqual(['new-tenant-item']);
});
it('keeps every item when the server rejects all and hides private upstream details', async () => {
 const button = await mountCart(batch => Response.json({ success: false, jobs: [], errors: batch.map(value => ({ wingetId: value.wingetId, error: 'Bearer private-fixture-token' })) }), { items: many(2) });
 await clickDeploy(button); expect(useCartStore.getState().items).toHaveLength(2); expect(mocks.success).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('private-fixture');
});

it('permits only one submission while token acquisition is pending', async () => {
 let resolve!: (value: string) => void; const pending = new Promise<string>(r => { resolve = r; });
 const button = await mountCart(started);
 auth.getAccessToken.mockImplementationOnce(() => pending).mockImplementationOnce(() => pending);
 await act(async () => { button.click(); button.click(); });
 await act(async () => resolve('fixture-token'));
 expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/package')).toHaveLength(1);
});

it('reports earlier starts when a later batch is blocked before upload', async () => {
 let requests = 0; const button = await mountCart(batch => ++requests === 1 ? started(batch) : Response.json({ code: 'MANIFEST_UNAVAILABLE', message: 'Selected version unavailable', retryable: false }, { status: 409 }), { items: many(25) });
 await clickDeploy(button); expect(requests).toBe(2); expect(useCartStore.getState().items).toHaveLength(15);
 expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('10 deployments started'), expect.objectContaining({ action: expect.any(Object) }));
 expect(document.body.textContent).toContain('Earlier deployments');
 expect(document.body.textContent).not.toContain('No packaging pipeline was started');
});
it('does not send a later item that was reconfigured while the first batch was pending', async () => {
 let resolve!: (response: Response) => void; const entries = many(11);
 const button = await mountCart(() => new Promise<Response>(r => { resolve = r; }), { items: entries }); await clickDeploy(button);
 await act(async () => useCartStore.getState().updateItem('item-10', { displayName: 'Edited configuration' }));
 await act(async () => resolve(started(entries.slice(0,10))));
 expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/package')).toHaveLength(1);
 expect(useCartStore.getState().items).toHaveLength(1);
 expect(useCartStore.getState().items[0].displayName).toBe('Edited configuration');
 expect(document.body.textContent).toContain('Changed during deployment, not sent.');
});
it('retains an uncertain item when a returned job has no cart identity', async () => {
 const button = await mountCart(() => Response.json({ success: true, jobs: [{ id: 'unmapped-job' }] })); await clickDeploy(button);
 expect(useCartStore.getState().items).toHaveLength(1); expect(mocks.success).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('check Deployments');
 expect(mocks.warning).toHaveBeenCalled();
});
it('preserves ordinary one app success navigation', async () => {
 const button = await mountCart(started); await clickDeploy(button);
 expect(useCartStore.getState().items).toHaveLength(0); expect(mocks.success).toHaveBeenCalled();
 expect(mocks.push).toHaveBeenCalledWith('/dashboard/uploads?jobs=job-test-app');
});

it('preserves a coded 400 installer preflight block after earlier batches started', async () => {
 let requests = 0; const explanation = 'This installer needs explicit silent switches.';
 const button = await mountCart(batch => ++requests === 1 ? started(batch) : Response.json({ code: 'SILENT_INSTALL_UNAVAILABLE', message: explanation, retryable: false }, { status: 400 }), { items: many(25) });
 await clickDeploy(button);
 expect(requests).toBe(2); expect(useCartStore.getState().items).toHaveLength(15);
 expect(document.body.textContent).toContain('Deployment blocked before upload'); expect(document.body.textContent).toContain(explanation);
 expect(document.body.textContent).not.toContain('Retry deployment');
 expect(document.body.textContent).toContain('Earlier deployments'); expect(mocks.warning).toHaveBeenCalled();
});

it('stops later batches for an unconfirmed custom dispatch returned as an item error', async () => {
 let requests = 0; const button = await mountCart(batch => { requests++; return Response.json({ success: false, jobs: [], errors: batch.map(value => ({ wingetId: value.wingetId, error: 'GitHub did not confirm that packaging started.', code: 'WORKFLOW_DISPATCH_UNCONFIRMED' })) }); }, { items: many(25) });
 await clickDeploy(button); expect(requests).toBe(1); expect(useCartStore.getState().items).toHaveLength(25);
 expect(document.body.textContent).toContain('check Deployments'); expect(mocks.success).not.toHaveBeenCalled();
});
it('labels uncertain and unsent items separately after a later request loses its response', async () => {
 let requests = 0; const button = await mountCart(batch => ++requests === 1 ? started(batch) : Promise.reject(new Error('Lost response')), { items: many(25) });
 await clickDeploy(button); expect(requests).toBe(2);
 const text = document.body.textContent ?? '';
 expect((text.match(/Outcome unknown/g) ?? []).length).toBe(10);
 expect((text.match(/Not sent/g) ?? []).length).toBe(5);
});
