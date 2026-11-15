// @vitest-environment happy-dom
import { act, createElement, Suspense, startTransition } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ user: { id: 'owner', tenantId: 'primary' }, tenant: 'customer-b', jobTenant: 'customer-b', jobOwner: 'owner', suspend: false, getToken: vi.fn(), fetch: vi.fn() }));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ user: f.user, getAccessToken: f.getToken, signIn: vi.fn() }) }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: true, selectedTenantId: f.tenant, managedTenants: [{ tenant_id: 'customer-b', display_name: 'Customer B' }] }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => null }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('gt-next', () => ({ T: ({ children }: { children: unknown }) => children, Var: ({ children }: { children: unknown }) => children, useGT: () => (text: string) => text, useLocale: () => 'en' }));
vi.mock('@/components/ProgressStepper', () => ({ ProgressStepper: () => { if (f.suspend) throw new Promise(() => {}); return null; } }));
vi.mock('framer-motion', async () => {
 const React = await import('react'); const cache = new Map();
 return { useReducedMotion: () => true, useInView: () => true, animate: () => ({ stop() {} }), AnimatePresence: ({ children }: { children: unknown }) => children,
 motion: new Proxy({}, { get: (_, tag: string) => {
  if (!cache.has(tag)) cache.set(tag, React.forwardRef(function MotionFixture(props: Record<string, unknown>, ref) {
   const clean = { ...props }; for (const key of ['initial','animate','exit','transition','layout','whileHover','whileTap','variants','custom']) delete clean[key];
   return React.createElement(tag, { ...clean, ref });
  })); return cache.get(tag);
 } }) };
});
import UploadsPage from './page';
let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
 f.user = { id: 'owner', tenantId: 'primary' }; f.tenant = 'customer-b'; f.jobTenant = 'customer-b'; f.jobOwner = 'owner'; f.suspend = false;
 f.getToken.mockReset().mockResolvedValue('fixture-token'); f.fetch.mockReset().mockImplementation(async (_url: string, options?: RequestInit) => options?.method === 'POST' ? Response.json({ success: true, jobs: [{ id: 'new-job' }] }) : Response.json({ jobs: [{ id: 'job', user_id: f.jobOwner, tenant_id: f.jobTenant, display_name: 'Example app', publisher: 'Example', winget_id: 'Example.App', version: '1', architecture: 'x64', installer_type: 'msi', status: 'failed', progress_percent: 0, created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z', package_config: { wingetId: 'Example.App', assignments: [] } }] }));
 vi.stubGlobal('fetch', f.fetch); const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function render() { await act(async () => root.render(createElement(Suspense, { fallback: 'Loading fixture' }, createElement(UploadsPage)))); }
function retry() { const b = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Retry safely'); expect(b).toBeDefined(); return b!; }
const posts = () => f.fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
it('retries a customer job in its original tenant and names the destination', async () => {
 await render(); expect(document.body.textContent).toContain('Tenant: Customer B'); await act(async () => retry().click());
 expect(posts()).toHaveLength(1); expect(posts()[0][1].headers['X-MSP-Tenant-Id']).toBe('customer-b');
 expect(JSON.parse(posts()[0][1].body).items[0].wingetId).toBe('Example.App');
});
it('refuses a retry when the selected tenant differs from the job tenant', async () => {
 f.tenant = 'customer-a'; await render(); await act(async () => retry().click()); expect(posts()).toHaveLength(0); expect(document.body.textContent).toContain('Select the original tenant');
});
it('refuses an old card after another account signs in', async () => {
 f.jobOwner = 'another-owner'; await render(); await act(async () => retry().click()); expect(posts()).toHaveLength(0);
});
it('rechecks the current tenant after token acquisition', async () => {
 await render(); let resolve!: (token: string) => void; f.getToken.mockImplementationOnce(() => new Promise<string>(r => { resolve = r; }));
 await act(async () => retry().click()); f.tenant = 'customer-a'; await render(); await act(async () => resolve('fixture-token')); expect(posts()).toHaveLength(0);
});
it('does not guess a destination for a job without a stored tenant', async () => {
 f.jobTenant = ''; await render(); await act(async () => retry().click()); expect(posts()).toHaveLength(0);
});

it('keeps the committed retry scope when React suspends a different tenant render', async () => {
 await render(); let resolve!: (token: string) => void; f.getToken.mockImplementationOnce(() => new Promise<string>(r => { resolve = r; }));
 await act(async () => retry().click());
 f.tenant = 'customer-a'; f.suspend = true;
 await act(async () => { startTransition(() => root.render(createElement(Suspense, { fallback: 'Loading fixture' }, createElement(UploadsPage)))); });
 expect(document.body.textContent).toContain('Example app');
 await act(async () => resolve('fixture-token'));
 expect(posts()).toHaveLength(1); expect(posts()[0][1].headers['X-MSP-Tenant-Id']).toBe('customer-b');
});

it('creates a duplicate app only after confirmation, and cancellation sends nothing', async () => {
 f.fetch.mockImplementation(async (_url: string, options?: RequestInit) => options?.method === 'POST' ? Response.json({ success:true,jobs:[{id:'new-job'}] }) : Response.json({jobs:[{id:'job',user_id:'owner',tenant_id:'customer-b',display_name:'Example app',publisher:'Example',winget_id:'Example.App',version:'1',architecture:'x64',installer_type:'msi',status:'duplicate_skipped',progress_percent:0,created_at:'2026-11-13T00:00:00Z',updated_at:'2026-11-13T00:00:00Z',error_details:{existingVersion:'1'},package_config:{wingetId:'Example.App',assignments:[]}}]}));
 await render();
 const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)!;
 await act(async()=>button('Deploy as new app anyway').click());
 expect(posts()).toHaveLength(0);expect(document.querySelector('[role="dialog"]')).not.toBeNull();
 await act(async()=>button('Keep existing app').click());expect(posts()).toHaveLength(0);
 await act(async()=>button('Deploy as new app anyway').click());
 await act(async()=>button('Deploy as new app').click());
 expect(posts()).toHaveLength(1);expect(JSON.parse(posts()[0][1].body).forceCreate).toBe(true);
});

