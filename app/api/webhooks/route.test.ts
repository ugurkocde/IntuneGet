import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({ allowed: true, client: null as unknown }));
const clientFactory = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: async () => fixture.allowed ? { userId: 'local-webhook-owner' } : null,
}));
async function route() {
  vi.doMock('@/lib/supabase', async () => {
    const original = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
    clientFactory.mockImplementation(() => fixture.client ?? original.createServerClient());
    return { ...original, createServerClient: clientFactory };
  });
  return import('./route');
}
async function GET(request: NextRequest) { return (await route()).GET(request); }
async function POST(request: NextRequest) { return (await route()).POST(request); }

const post = (body: unknown) => new NextRequest('http://localhost/api/webhooks', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const valid = { name: ' Local fixture ', url: 'https://example.test/webhook', webhook_type: 'custom' };
const unavailable = { error: 'Webhook notifications require Supabase to be configured for this deployment.' };
beforeEach(() => {
  vi.resetModules(); vi.doUnmock('@/lib/supabase');
  fixture.allowed = true; fixture.client = null; clientFactory.mockClear();
  vi.stubEnv('DATABASE_MODE', 'sqlite'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ''); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in route tests'); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function configured(client: unknown) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'local-test-placeholder'); fixture.client = client;
}
describe('webhook notification configuration', () => {
  it.each(['GET', 'POST'])('explains unavailable storage for %s without constructing a client', async (method) => {
    const response = method === 'GET'
      ? await GET(new NextRequest('http://localhost/api/webhooks')) : await POST(post(valid));
    expect(response.status).toBe(503); expect(await response.json()).toEqual(unavailable);
    expect(clientFactory).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['GET', 'POST'])('keeps authentication ahead of configuration for %s', async (method) => {
    fixture.allowed = false;
    const response = method === 'GET'
      ? await GET(new NextRequest('http://localhost/api/webhooks')) : await POST(post(valid));
    expect(response.status).toBe(401); expect(clientFactory).not.toHaveBeenCalled();
  });
  it.each([{ ...valid, name: '' }, { ...valid, url: 'http://example.test/webhook' }, { ...valid, webhook_type: 'invalid' }])(
    'retains input validation before storage lookup', async (body) => {
      const response = await POST(post(body));
      expect(response.status).toBe(400); expect(clientFactory).not.toHaveBeenCalled();
    }
  );
  it('retains configured list ownership and secret masking', async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'local-record', secret: 'test-secret' }], error: null });
    const eq = vi.fn(() => ({ order }));
    configured({ from: () => ({ select: () => ({ eq }) }) });
    const response = await GET(new NextRequest('http://localhost/api/webhooks'));
    expect(response.status).toBe(200); expect(eq).toHaveBeenCalledWith('user_id', 'local-webhook-owner');
    expect(await response.json()).toEqual({ webhooks: [{ id: 'local-record', secret: '********' }] });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains configured creation ownership, name trimming and secret masking', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'local-record', secret: 'test-secret' }, error: null });
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    const eq = vi.fn().mockResolvedValue({ count: 0, error: null });
    configured({ from: () => ({ select: () => ({ eq }), insert }) });
    const response = await POST(post({ ...valid, secret: 'test-secret' }));
    expect(response.status).toBe(201); expect(eq).toHaveBeenCalledWith('user_id', 'local-webhook-owner');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Local fixture', user_id: 'local-webhook-owner' }));
    expect(await response.json()).toEqual({ webhook: { id: 'local-record', secret: '********' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains the configured webhook limit', async () => {
    const insert = vi.fn();
    configured({ from: () => ({ select: () => ({ eq: async () => ({ count: 10, error: null }) }), insert }) });
    const response = await POST(post(valid));
    expect(response.status).toBe(400); expect(insert).not.toHaveBeenCalled();
  });
  it('retains a configured database failure as a server error', async () => {
    configured({ from: () => ({ select: () => ({ eq: async () => ({ count: null, error: { code: 'local-failure' } }) }) }) });
    const response = await POST(post(valid));
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: 'Failed to create webhook' });
  });
});
