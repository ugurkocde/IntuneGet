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

it.each(['network', 'server'])('retries a transient %s progress lookup on the existing refresh', async (failure) => {
 vi.useFakeTimers(); f.ids=id(51); let attempts=0;
 f.fetch.mockImplementation(async (url:string) => {
  if (!url.includes('?jobId=')) return Response.json({jobs:[]});
  if (attempts++ === 0) { if(failure === 'network') throw new Error('Synthetic network failure'); return Response.json({error:'Synthetic unavailable'}, {status:503}); }
  return Response.json({job:job(51,'Recovered requested app')});
 });
 await render(); expect(extraCalls()).toHaveLength(1);
 await act(async()=>vi.advanceTimersByTimeAsync(5000));
 expect(extraCalls()).toHaveLength(2); expect(document.body.textContent).toContain('Recovered requested app');
});

it('keeps retry reads bounded while giving unread jobs a turn', async () => {
 vi.useFakeTimers(); f.ids=[1,2,3,4,5].map(id).join(',');
 f.fetch.mockImplementation(async(url:string)=>url.includes('?jobId=') ? Response.json({error:'Synthetic unavailable'},{status:503}) : Response.json({jobs:[]}));
 await render(); expect(extraCalls()).toHaveLength(4);
 await act(async()=>vi.advanceTimersByTimeAsync(5000));
 expect(extraCalls()).toHaveLength(8); expect(extraCalls().some(([url])=>String(url).endsWith(id(5)))).toBe(true);
});

it('keeps a dismissed highlighted job out of the next refreshed list', async () => {
 f.ids=id(51); let dismissed=false;
 f.fetch.mockImplementation(async(url:string) => {
  if(url==='/api/package/cancel'){dismissed=true;return Response.json({success:true});}
  if(url.includes('?jobId='))return dismissed?Response.json({error:'Not found'},{status:404}):Response.json({job:job(51,'Dismiss fixture')});
  return Response.json({jobs:[]});
 });
 await render(); expect(document.body.textContent).toContain('Dismiss fixture');
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Dismiss')!.click());
 await act(async()=>[...document.querySelectorAll('button')].filter(b=>b.textContent?.trim()==='Dismiss').at(-1)!.click());
 expect(dismissed).toBe(true); expect(document.body.textContent).not.toContain('Dismiss fixture');
});

it('filters the same stopped jobs counted by the Failed card', async () => {
 f.fetch.mockResolvedValue(Response.json({ jobs: [
  { ...job(1, 'Failed fixture'), status: 'failed' },
  { ...job(2, 'Stopped fixture'), status: 'qa_failed' },
  { ...job(3, 'Cancelled fixture'), status: 'cancelled' },
 ] }));
 await render();
 const failed = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Failed')!;
 await act(async () => failed.click());
 expect(document.body.textContent).toContain('Failed fixture');
 expect(document.body.textContent).toContain('Stopped fixture');
 expect(document.body.textContent).not.toContain('Cancelled fixture');
});

it('offers Clear History when only cancelled jobs remain', async () => {
 f.fetch.mockResolvedValue(Response.json({ jobs: [{ ...job(1), status: 'cancelled' }] }));
 await render();
 expect([...document.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Clear History')).toBe(true);
});

const actionButtons = (label: string) => [...document.querySelectorAll('button')].filter(b => b.textContent?.trim() === label);
const confirmCancel = async () => {
 await act(async () => actionButtons('Cancel')[0].click());
 await act(async () => actionButtons('Cancel Upload')[0].click());
};
it('hides Cancel and Dismiss for teammate jobs in tenant view', async () => {
 f.fetch.mockResolvedValue(Response.json({ jobs: [{ ...job(1), user_id: 'teammate', status: 'queued' }, { ...job(2), user_id: 'teammate' }] }));
 await render(); await act(async () => actionButtons('All in tenant')[0].click());
 expect(actionButtons('Cancel')).toHaveLength(0); expect(actionButtons('Dismiss')).toHaveLength(0);
});
it('keeps owner actions available and prevents a second action while the token is pending', async () => {
 f.fetch.mockResolvedValue(Response.json({ jobs: [{ ...job(1), status: 'queued' }, { ...job(2), status: 'queued' }] }));
 await render(); let release!: (value: string | null) => void;
 f.getToken.mockImplementation(() => new Promise(resolve => { release = resolve; }));
 await confirmCancel();
 expect(actionButtons('Cancel')[0].disabled).toBe(true);
 await act(async () => actionButtons('Cancel').find(b => !b.disabled)?.click());
 await act(async () => actionButtons('Cancel Upload')[0]?.click());
 expect(document.body.textContent).toContain('Wait for the current deployment action');
 expect(f.getToken).toHaveBeenCalledTimes(2); // initial list token and one action token
 await act(async () => release(null));
 expect(actionButtons('Cancel').every(b => !b.disabled)).toBe(true);
 expect(f.fetch.mock.calls.filter(([url]) => url === '/api/package/cancel')).toHaveLength(0);
});
it('restores the owned row and clears the pending action when the server refuses it', async () => {
 f.fetch.mockImplementation(async (url: string) => url === '/api/package/cancel'
  ? Response.json({ error: 'Synthetic permission refusal' }, { status: 403 })
  : Response.json({ jobs: [{ ...job(1, 'Owned active fixture'), status: 'queued' }] }));
 await render(); await confirmCancel();
 expect(document.body.textContent).toContain('Synthetic permission refusal');
 expect(document.body.textContent).toContain('Owned active fixture');
 expect(actionButtons('Cancel')[0].disabled).toBe(false);
});

it('does not submit a second job while the first POST is pending', async () => {
 let finish!: (response: Response) => void;
 f.fetch.mockImplementation((url: string) => url === '/api/package/cancel'
  ? new Promise(resolve => { finish = resolve; })
  : Promise.resolve(Response.json({ jobs: [{ ...job(1), status: 'queued' }, { ...job(2), status: 'queued' }] })));
 await render(); await confirmCancel(); await confirmCancel();
 expect(f.fetch.mock.calls.filter(([url]) => url === '/api/package/cancel')).toHaveLength(1);
 await act(async () => finish(Response.json({ success: true })));
 expect(actionButtons('Cancel').every(b => !b.disabled)).toBe(true);
});
it('clears the pending action after a token rejection', async () => {
 f.fetch.mockResolvedValue(Response.json({ jobs: [{ ...job(1), status: 'queued' }] }));
 await render(); f.getToken.mockRejectedValueOnce(new Error('Synthetic token failure'));
 await confirmCancel();
 expect(actionButtons('Cancel')[0].disabled).toBe(false);
 expect(f.fetch.mock.calls.filter(([url]) => url === '/api/package/cancel')).toHaveLength(0);
});
it('does not send an old owner action after an account switch during token acquisition', async () => {
 f.fetch.mockResolvedValue(Response.json({ jobs: [{ ...job(1), status: 'queued' }] }));
 await render(); let release!: (value: string) => void;
 f.getToken.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
 await confirmCancel(); f.user = { id: 'other-owner', tenantId: 'primary' }; await render();
 await act(async () => release('fixture-token'));
 expect(f.fetch.mock.calls.filter(([url]) => url === '/api/package/cancel')).toHaveLength(0);
});

it('preserves refreshed rows when action token acquisition rejects', async () => {
 let rows = [{ ...job(1, 'Old snapshot'), status: 'queued' }];
 f.fetch.mockImplementation(async () => Response.json({ jobs: rows }));
 await render(); let reject!: (error: Error) => void;
 f.getToken.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
 await confirmCancel();
 rows = [{ ...job(2, 'Fresh snapshot'), status: 'queued' }];
 await act(async () => actionButtons('Refresh')[0].click());
 expect(document.body.textContent).toContain('Fresh snapshot');
 await act(async () => reject(new Error('Synthetic delayed token failure')));
 expect(document.body.textContent).toContain('Fresh snapshot');
 expect(document.body.textContent).not.toContain('Old snapshot');
 expect(f.fetch.mock.calls.filter(([url]) => url === '/api/package/cancel')).toHaveLength(0);
});
it('does not cancel stale owned rows while a newly selected tenant list is pending', async () => {
 f.fetch.mockResolvedValue(Response.json({ jobs: [{ ...job(1), status: 'queued' }] }));
 await render();
 f.getToken.mockImplementationOnce(() => new Promise(() => {}));
 f.tenant = 'customer-c'; await render();
 await confirmCancel();
 expect(document.body.textContent).toContain('Refresh deployments before cancelling');
 expect(f.fetch.mock.calls.filter(([url]) => url === '/api/package/cancel')).toHaveLength(0);
});

it.each([
 { tenant: 'customer-b', jobTenant: 'customer-c' },
 { tenant: '', jobTenant: 'customer-c' },
 { tenant: 'customer-b', jobTenant: undefined },
].flatMap(scope => [false, true].map(dismiss => ({ ...scope, dismiss }))))('allows owned jobs in a fresh mine list regardless of destination: %j', async ({ tenant, jobTenant, dismiss }) => {
 f.tenant = tenant;
 f.fetch.mockImplementation(async (url: string) => url === '/api/package/cancel'
  ? Response.json({ success: true })
  : Response.json({ jobs: [{ ...job(1), tenant_id: jobTenant, status: dismiss ? 'deployed' : 'queued' }] }));
 await render();
 if (dismiss) {
  await act(async () => actionButtons('Dismiss')[0].click());
  await act(async () => actionButtons('Dismiss').at(-1)!.click());
 } else await confirmCancel();
 const posts = f.fetch.mock.calls.filter(([url]) => url === '/api/package/cancel');
 expect(posts).toHaveLength(1);
 expect(JSON.parse(posts[0][1].body)).toEqual({ jobId: id(1), dismiss });
});
it.each(['cancel', 'dismiss'])('preserves refreshed rows and statuses after a failed %s POST', async (action) => {
 let finish!: (response: Response) => void;
 let rows = [{ ...job(1, 'Owned row'), status: action === 'cancel' ? 'queued' : 'deployed' }];
 f.fetch.mockImplementation((url: string) => url === '/api/package/cancel'
  ? new Promise(resolve => { finish = resolve; })
  : Promise.resolve(Response.json({ jobs: rows })));
 await render();
 if (action === 'cancel') await confirmCancel();
 else {
  await act(async () => actionButtons('Dismiss')[0].click());
  await act(async () => actionButtons('Dismiss').at(-1)!.click());
 }
 rows = [{ ...job(1, 'Updated owned row'), status: 'deployed' }, { ...job(2, 'New refreshed row'), status: 'deployed' }];
 await act(async () => actionButtons('Refresh')[0].click());
 await act(async () => finish(Response.json({ error: 'Synthetic POST failure' }, { status: 403 })));
 expect(document.body.textContent).toContain('Updated owned row');
 expect(document.body.textContent).toContain('New refreshed row');
 expect(document.body.textContent).toContain('Synthetic POST failure');
 expect(actionButtons('Cancel')).toHaveLength(0);
});

it('removes only a confirmed dismissed row even if the reconciliation refresh fails', async () => {
 let finish!: (response: Response) => void;
 let dismissed = false;
 let rows = [job(1, 'Dismissed fixture'), job(2, 'Original survivor')];
 f.fetch.mockImplementation((url: string) => url === '/api/package/cancel'
  ? new Promise(resolve => { finish = resolve; })
  : Promise.resolve(dismissed ? Response.json({ error: 'Synthetic refresh failure' }, { status: 503 }) : Response.json({ jobs: rows })));
 await render();
 await act(async () => actionButtons('Dismiss')[0].click());
 await act(async () => actionButtons('Dismiss').at(-1)!.click());
 rows = [job(1, 'Dismissed fixture'), job(2, 'Updated survivor'), job(3, 'New survivor')];
 await act(async () => actionButtons('Refresh')[0].click());
 dismissed = true;
 await act(async () => finish(Response.json({ success: true })));
 expect(document.body.textContent).not.toContain('Dismissed fixture');
 expect(document.body.textContent).toContain('Updated survivor');
 expect(document.body.textContent).toContain('New survivor');
 expect(document.body.textContent).toContain('Synthetic refresh failure');
});
