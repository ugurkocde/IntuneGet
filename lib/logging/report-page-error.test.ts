import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('sends only fixed area and numeric digest and caps reset loops', async () => {
  vi.resetModules(); const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal('fetch', send);
  const { reportPageError } = await import('./report-page-error');
  reportPageError('root', 'private message'); reportPageError('dashboard', '123'); reportPageError('root'); reportPageError('root');
  expect(send).toHaveBeenCalledTimes(3);
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ event: 'page_error', area: 'root' });
  expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({ event: 'page_error', area: 'dashboard', digest: '123' });
});
it('swallows synchronous and asynchronous reporting failures', async () => {
  vi.resetModules(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const { reportPageError } = await import('./report-page-error'); expect(() => reportPageError('root')).not.toThrow();
  await Promise.resolve(); vi.stubGlobal('fetch', () => { throw new Error('blocked'); }); expect(() => reportPageError('root')).not.toThrow();
});
