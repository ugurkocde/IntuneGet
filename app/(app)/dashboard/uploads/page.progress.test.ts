// @vitest-environment happy-dom
import { act, createElement, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ user: { id: 'owner', tenantId: 'primary' }, tenant: 'customer-b', jobTenant: 'customer-b', jobOwner: 'owner', suspend: false, ids: '', getToken: vi.fn(), fetch: vi.fn() }));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ user: f.user, getAccessToken: f.getToken, signIn: vi.fn() }) }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: true, selectedTenantId: f.tenant, managedTenants: [{ tenant_id: 'customer-b', display_name: 'Customer B' }] }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: (key: string) => key === 'jobs' ? f.ids : null }), useRouter: () => ({ push: vi.fn() }) }));
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

const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const job = (n: number, name = 'Fixture app ' + n) => ({ id: id(n), user_id: 'owner', tenant_id: 'customer-b', display_name: name, publisher: 'Example', winget_id: 'Example.App'+n, version: '1', architecture: 'x64', installer_type: 'msi', status: 'deployed', progress_percent: 100, created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z' });
const render = async () => { await act(async () => root.render(createElement(UploadsPage))); };
const extraCalls = () => f.fetch.mock.calls.filter(([url]) => String(url).includes('?jobId='));
beforeEach(() => { f.ids = ''; f.user = { id: 'owner', tenantId: 'primary' }; f.tenant = 'customer-b'; f.suspend = false; f.getToken.mockReset().mockResolvedValue('fixture-token'); f.fetch.mockReset(); vi.stubGlobal('fetch', f.fetch); const node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML=''; vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });
it('renders a requested owned job beyond the ordinary fifty', async () => {
 f.ids=id(51); f.fetch.mockImplementation(async (url: string) => url.includes('?jobId=') ? Response.json({ job: job(51,'Older requested app') }) : Response.json({ jobs: Array.from({length:50},(_,i)=>job(i+1)) }));
 await render(); expect(document.body.textContent).toContain('Older requested app'); expect(extraCalls()).toHaveLength(1);
});
it('loads at most four missing jobs per round and continues using the existing refresh', async () => {
 vi.useFakeTimers(); f.ids=Array.from({length:6},(_,i)=>id(i+1)).join(',');
 f.fetch.mockImplementation(async (url: string) => url.includes('?jobId=') ? Response.json({ job: job(Number(url.split('-').at(-1))) }) : Response.json({ jobs: [] }));
 await render(); expect(extraCalls()).toHaveLength(4); await act(async()=>vi.advanceTimersByTimeAsync(5000)); expect(extraCalls()).toHaveLength(6);
});
it('ignores foreign, mismatched, archived and absent jobs without a page error', async () => {
 f.ids=[1,2,3,4].map(id).join(','); f.fetch.mockImplementation(async (url: string) => {
 if(!url.includes('?jobId='))return Response.json({jobs:[]}); const n=Number(url.split('-').at(-1));
 if(n===4)return Response.json({error:'Not found'},{status:404});
 return Response.json({job:n===1?{...job(1,'Foreign fixture'),user_id:'other'}:n===2?job(99,'Mismatched fixture'):{...job(3,'Archived fixture'),archived_at:'2026-11-13T00:00:00Z'}});
 }); await render(); expect(extraCalls()).toHaveLength(4); expect(document.body.textContent).not.toMatch(/Foreign fixture|Mismatched fixture|Archived fixture|Failed to fetch/);
});
it('does not fetch highlighted jobs individually in tenant view', async () => {
 f.ids=id(51); f.fetch.mockImplementation(async(url:string)=>url.includes('?jobId=')?Response.json({job:job(51)}):Response.json({jobs:[]}));
 await render(); f.fetch.mockClear(); const button=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='All in tenant')!;
 await act(async()=>button.click()); expect(extraCalls()).toHaveLength(0); expect(f.fetch.mock.calls.some(([url])=>url==='/api/package?scope=tenant')).toBe(true);
});
