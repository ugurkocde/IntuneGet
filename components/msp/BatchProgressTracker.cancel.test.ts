// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ isAuthenticated: true, getAccessToken: async () => 'fixture' }) }));
vi.mock('gt-next', () => ({ T: ({ children }: { children: React.ReactNode }) => children }));
import { BatchProgressTracker } from './BatchProgressTracker';
const batch = (id = 'fixture-batch', status = 'in_progress') => ({ id, status, display_name: 'Fixture app', winget_id: 'Fixture.App', version: '1', total_tenants: 2, completed_tenants: 0, failed_tenants: 0, created_at: '2026-01-01', cancelled_at: status === 'cancelled' ? new Date().toISOString() : null, items: [] });
afterEach(() => vi.unstubAllGlobals());
async function setup(status = 'in_progress', response = Response.json({ success: true }), activeItem = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let cancelled = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') { cancelled = response.ok; return response; }
    const result = batch(url.split('/').at(-1), cancelled ? 'cancelled' : status);
    return Response.json({ batch: { ...result, items: activeItem ? [{ id: 'fixture-item', status: 'in_progress', tenant_display_name: 'Fixture tenant' }] : [] } });
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidation = vi.spyOn(client, 'invalidateQueries');
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const render = async (id = 'fixture-batch') => { await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(BatchProgressTracker, { batchId: id }))); await new Promise(r => setTimeout(r, 30)); }); await act(async () => { await new Promise(r => setTimeout(r, 30)); }); };
  await render();
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  const click = async (text: string) => { expect(button(text), text).toBeDefined(); await act(async () => { button(text)!.click(); await new Promise(r => setTimeout(r, 30)); }); };
  return { client, fetcher, invalidation, button, click, render, close: async () => { await act(async () => root.unmount()); client.clear(); node.remove(); } };
}
it('requires confirmation, dismisses without cancelling, then sends one authorized cancellation and refreshes both views', async () => {
  const t = await setup();try {
    await t.click('Cancel batch'); expect(t.fetcher.mock.calls.filter(([, x]) => x?.method === 'DELETE')).toHaveLength(0);
    expect(document.body.textContent).toContain('Deployments already in progress will finish.'); await t.click('Keep batch');
    expect(t.fetcher.mock.calls.filter(([, x]) => x?.method === 'DELETE')).toHaveLength(0);
    await t.click('Cancel batch'); await t.click('Confirm cancellation');
    expect(t.fetcher.mock.calls.filter(([, x]) => x?.method === 'DELETE')).toEqual([['/api/msp/batch-deployments/fixture-batch', { method: 'DELETE', headers: { Authorization: 'Bearer fixture' } }]]);
    expect(t.invalidation).toHaveBeenCalledWith({ queryKey: ['batch-deployment', 'fixture-batch'] });
    expect(t.invalidation).toHaveBeenCalledWith({ queryKey: ['batch-deployments'] });
    expect(t.button('Cancel batch')).toBeUndefined();
  }finally { await t.close(); }
});
it.each(['completed','cancelled','failed'])('hides cancel for %s', async status => { const t = await setup(status); try { expect(t.button('Cancel batch')).toBeUndefined(); }finally { await t.close(); } });
it.each([403,500])('keeps the batch and shows only a safe error on %s', async status => {
  const t = await setup('pending',Response.json({ error: 'secret raw server message' },{status}));try {
    await t.click('Cancel batch');await t.click('Confirm cancellation');
    expect(document.body.textContent).toContain(status === 403 ? 'You do not have permission to cancel this batch' : 'Failed to cancel batch deployment');
    expect(document.body.textContent).not.toContain('secret raw server message'); expect(document.body.textContent).toContain('Fixture app');
  }finally{await t.close();}
});
it('disables duplicate confirmation and does not refresh the new batch after an old request settles', async () => {
  const t = await setup();let resolve!: (r: Response) => void;const pending = new Promise<Response>(r => { resolve = r; });
  try {
    const initial = t.fetcher.getMockImplementation()!;
    t.fetcher.mockImplementation((url, init) => init?.method === 'DELETE' ? pending : initial(url, init));
    await t.click('Cancel batch');await t.click('Confirm cancellation');
    expect(t.button('Cancel batch')?.disabled).toBe(true);expect(t.button('Confirm cancellation')?.disabled).toBe(true);
    t.button('Confirm cancellation')!.click();expect(t.fetcher.mock.calls.filter(([, x]) => x?.method === 'DELETE')).toHaveLength(1);
    await t.render('other-batch');expect(t.button('Confirm cancellation')).toBeUndefined();
    await act(async () => { resolve(Response.json({success:true}));await pending; });
    expect(t.invalidation).toHaveBeenCalledWith({ queryKey: ['batch-deployment', 'fixture-batch'] });
    expect(t.invalidation).toHaveBeenCalledWith({ queryKey: ['batch-deployments'] });
    expect(t.invalidation).not.toHaveBeenCalledWith({ queryKey: ['batch-deployment', 'other-batch'] });
  }finally{await t.close();}
});

it('keeps observing an active item after cancellation and stops when it finishes', async () => {
  const t = await setup('cancelled', Response.json({ success: true }), true);
  try {
    const query = t.client.getQueryCache().find({ queryKey: ['batch-deployment', 'fixture-batch'] })!;
    const interval = query.options.refetchInterval;
    expect(typeof interval).toBe('function');
    if (typeof interval !== 'function') throw new Error('Expected polling decision');
    expect(interval(query)).toBe(5000);
    await act(async () => { t.client.setQueryData(['batch-deployment', 'fixture-batch'], { batch: { ...batch('fixture-batch', 'cancelled'), items: [{ id: 'fixture-item', status: 'completed' }] } }); });
    expect(interval(query)).toBe(false);
  } finally { await t.close(); }
});

it('bounds cancelled polling from the recorded cancellation time', async () => {
  const t = await setup('cancelled', Response.json({ success: true }), true);
  try {
    const query = t.client.getQueryCache().find({ queryKey: ['batch-deployment', 'fixture-batch'] })!;
    const interval = query.options.refetchInterval;
    if (typeof interval !== 'function') throw new Error('Expected polling decision');
    const now = Date.now();
    for (const [cancelled_at, expected] of [[new Date(now - 44 * 60000).toISOString(), 5000], [new Date(now - 46 * 60000).toISOString(), false], [null, false], ['invalid', false]] as const) {
      await act(async () => { t.client.setQueryData(['batch-deployment', 'fixture-batch'], { batch: { ...batch('fixture-batch', 'cancelled'), cancelled_at, items: [{ id: 'fixture-item', status: 'in_progress' }] } }); });
      expect(interval(query)).toBe(expected);
    }
  } finally { await t.close(); }
});
