import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { SupabaseCatalogSource } from './supabase-source';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});

it('lets a deep global response finish after six seconds within the eight second budget without duplicating it', async () => {
  let requests = 0;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const result = { rows: [], total: 100000, apps: 9000, firstTracked: 9000,
    months: ['2026-11'], coverageStart: '2026-01-01', sync: null };
  const server = createServer((_request, response) => {
    requests++;
    timers.push(setTimeout(() => {
      if (!response.destroyed) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
      }
    }, 6000));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections(); server.close(() => resolve());
  }));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(new SupabaseCatalogSource().getReleaseHistory({ query: '', month: '', kind: 'all', page: 1414 }))
    .resolves.toEqual(result);
  expect(requests).toBe(1);
}, 12000);
