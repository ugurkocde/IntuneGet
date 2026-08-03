import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('node-fetch', () => ({
  default: fetchMock,
}));

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => body,
  };
}

async function freshProxyHttpClient() {
  // fetch-with-proxy.ts caches resolved agents at module scope.
  vi.resetModules();
  const { ProxyHttpClient } = await import('../src/msal-proxy-http-client.js');
  return new ProxyHttpClient();
}

describe('ProxyHttpClient', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    fetchMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('routes msal token requests through the proxy agent, unlike native fetch with a runtime-set NODE_USE_ENV_PROXY', async () => {
    // This mirrors the actual bug: NODE_USE_ENV_PROXY=1 loaded from .env at
    // runtime (after Node's network stack already initialized) is silently
    // ignored by undici, so a raw fetch() would bypass the proxy and fail
    // with ECONNREFUSED on a proxy-only host. Verify our client attaches
    // the proxy agent regardless of when the env var was set.
    process.env.HTTPS_PROXY = 'http://proxy.example.com:3128';
    process.env.NODE_USE_ENV_PROXY = '1'; // set at runtime, same as dotenv would

    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'token' }));
    const client = await freshProxyHttpClient();

    const response = await client.sendPostRequestAsync(
      'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
      { body: 'grant_type=client_credentials' }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as { agent?: unknown })?.agent).toBeDefined();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ access_token: 'token' });
  });

  it('sends GET requests without a body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ value: [] }));
    const client = await freshProxyHttpClient();

    await client.sendGetRequestAsync('https://graph.microsoft.com/beta/deviceAppManagement');

    const [, init] = fetchMock.mock.calls[0];
    expect((init as { method?: string }).method).toBe('GET');
    expect((init as { body?: unknown }).body).toBeUndefined();
  });

  it('forwards response headers as a plain dict', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const client = await freshProxyHttpClient();

    const response = await client.sendGetRequestAsync('https://graph.microsoft.com/beta/x');

    expect(response.headers).toEqual({ 'content-type': 'application/json' });
  });
});
