import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { ProxyRouting } from '../src/proxy-routing.js';
import { ProxyMsalNetwork } from '../src/proxy-msal.js';
import { createClient } from '@supabase/supabase-js';

const servers: Server[] = [];
const routes: ProxyRouting[] = [];
afterEach(async () => {
  routes.splice(0).forEach(route => route.close());
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
async function fixture(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture');
  const route = new ProxyRouting({HTTP_PROXY:`http://fixture-user:fixture-pass@127.0.0.1:${address.port}`});routes.push(route);
  return {route, server};
}
describe('MSAL and platform fetch proxy transports', () => {
  it('preserves POST bytes, status and response headers without returning proxy credentials', async () => {
    const observed: {url?:string,body?:string,auth?:string} = {};
    const {route} = await fixture((req, res) => {
      observed.url=req.url;observed.auth=String(req.headers['proxy-authorization']);
      let body='';req.on('data', chunk => {body+=chunk;});req.on('end',()=>{observed.body=body;res.writeHead(429,{'retry-after':'12','content-type':'application/json'});res.end('{"error":"synthetic_throttle"}');});
    });
    const result=await new ProxyMsalNetwork(route).sendPostRequestAsync('http://token.invalid/token',{body:'grant_type=client_credentials&client_secret=synthetic',headers:{'content-type':'application/x-www-form-urlencoded'}});
    expect(result).toMatchObject({status:429,headers:{'retry-after':'12'},body:{error:'synthetic_throttle'}});
    expect(observed.body).toBe('grant_type=client_credentials&client_secret=synthetic');
    expect(observed.auth).toBe('Basic '+Buffer.from('fixture-user:fixture-pass').toString('base64'));
    expect(JSON.stringify(result)).not.toContain('fixture-pass');
    expect(route.agentFor(new URL('http://token.invalid'))).toHaveProperty('proxy.username', '');
  });
  it('times out GET without leaking raw transport details and keeps MSAL error codes', async () => {
    const {route}=await fixture(() => {});
    await expect(new ProxyMsalNetwork(route).sendGetRequestAsync('http://token.invalid/slow',undefined,20)).rejects.toMatchObject({errorCode:'network_error',errorMessage:expect.stringContaining('Request timeout')});
  });
  it('retains the token parsing error category', async () => {
    const {route}=await fixture((_req,res)=>res.end('not JSON'));
    await expect(new ProxyMsalNetwork(route).sendGetRequestAsync('http://token.invalid')).rejects.toMatchObject({errorCode:'token_parsing_error'});
  });
  it('allows the real Supabase SDK to read rows through the configured route', async () => {
    const requests:string[]=[];
    const {route}=await fixture((req,res)=>{requests.push(req.url??'');res.writeHead(200,{'content-type':'application/json'});res.end('[{"id":"synthetic-job"}]');});
    const sdk=createClient('http://database.invalid','synthetic-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:route.webFetch}});
    const result=await sdk.from('packaging_jobs').select('id');
    expect(result.error).toBeNull();expect(result.data).toEqual([{id:'synthetic-job'}]);
    expect(requests[0]).toContain('http://database.invalid/rest/v1/packaging_jobs?select=id');
  });
  it('supports Request input, JSON request bytes, empty HTTP responses and aborts', async () => {
    const seen=vi.fn();const {route}=await fixture((req,res)=>{seen(req.method);res.writeHead(204);res.end();});
    const result=await route.webFetch(new Request('http://api.invalid/job',{method:'POST',body:'{}'}));
    expect(result.status).toBe(204);expect(await result.text()).toBe('');expect(seen).toHaveBeenCalledWith('POST');
    const controller=new AbortController();controller.abort();
    await expect(route.webFetch('http://api.invalid/job',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  });
});
