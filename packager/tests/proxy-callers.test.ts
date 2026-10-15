import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiClient } from '../src/api-client.js';
import { JobProcessor } from '../src/job-processor.js';
import { ProxyRouting } from '../src/proxy-routing.js';
import type { PackagerConfig } from '../src/config.js';

vi.mock('../src/logger.js', () => ({createLogger: () => ({info:vi.fn(),debug:vi.fn(),warn:vi.fn(),error:vi.fn(),progress:vi.fn()})}));
const servers: Server[] = [];
const routes: ProxyRouting[] = [];
afterEach(async () => {
  routes.splice(0).forEach(route => route.close());
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
});
async function proxy(body: string, contentType = 'application/json') {
  const requests: string[] = [];
  const server = createServer((req, res) => {requests.push(req.url ?? '');res.setHeader('content-type', contentType);res.end(body);});
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback fixture');
  const route = new ProxyRouting({HTTP_PROXY:`http://127.0.0.1:${address.port}`});
  routes.push(route);
  return {route, requests};
}
function config(route: ProxyRouting): PackagerConfig {
  return {packagerId:'fixture',mode:'api',api:{url:'http://127.0.0.1:1',key:'synthetic-key'},supabase:{url:'',serviceRoleKey:''},azure:{clientId:'00000000-0000-0000-0000-000000000001',clientSecret:'synthetic-secret',useManagedIdentity:false},polling:{interval:5000,staleJobTimeout:300000},paths:{work:tmpdir(),tools:tmpdir()},proxy:route} as PackagerConfig;
}
describe('real packager callers on a proxy only route', () => {
  it('routes API polling through the configured proxy', async () => {
    const fixture = await proxy('{"jobs":[]}');
    expect(await new ApiClient(config(fixture.route)).getQueuedJobs()).toEqual([]);
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatch(/^http:\/\/127\.0\.0\.1:1\/api\/packager\/jobs/);
  });
  it('routes installer and tool downloadFile through the proxy without running bytes', async () => {
    const fixture = await proxy('inert download fixture', 'application/octet-stream');
    const directory = await mkdtemp(join(tmpdir(), 'intuneget-proxy-fixture-'));
    try {
      const processor = new JobProcessor(config(fixture.route), null);
      await Reflect.get(processor, 'downloadFile').call(processor, 'http://127.0.0.1:1/inert.fixture', join(directory, 'inert.fixture'));
      expect(await readFile(join(directory, 'inert.fixture'), 'utf8')).toBe('inert download fixture');
      expect(fixture.requests).toEqual(['http://127.0.0.1:1/inert.fixture']);
    } finally { await rm(directory, {recursive:true,force:true}); }
  });
});
