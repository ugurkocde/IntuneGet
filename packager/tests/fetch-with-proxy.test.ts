import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('node-fetch', () => ({
  default: fetchMock,
}));

const ORIGINAL_ENV = { ...process.env };

async function freshFetchWithProxy() {
  // The module caches resolved proxy agents in module-level state, so each
  // test needs its own fresh import to observe a clean cache.
  vi.resetModules();
  return (await import('../src/fetch-with-proxy.js')).fetchWithProxy;
}

describe('fetchWithProxy', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.NO_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.no_proxy;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('does not pass an agent when no proxy env vars are set', async () => {
    const fetchWithProxy = await freshFetchWithProxy();

    await fetchWithProxy('https://graph.microsoft.com/beta/deviceAppManagement');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/beta/deviceAppManagement',
      {}
    );
  });

  it('attaches an HttpsProxyAgent for https URLs when HTTPS_PROXY is set', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.example.com:3128';
    const fetchWithProxy = await freshFetchWithProxy();

    await fetchWithProxy('https://graph.microsoft.com/beta/deviceAppManagement');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as { agent?: unknown })?.agent).toBeDefined();
  });

  it('bypasses the proxy for hosts covered by NO_PROXY', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.example.com:3128';
    process.env.NO_PROXY = 'internal.example.com';
    const fetchWithProxy = await freshFetchWithProxy();

    await fetchWithProxy('https://packager-api.internal.example.com/api/packager/jobs');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://packager-api.internal.example.com/api/packager/jobs',
      {}
    );
  });

  it('reuses the same agent instance across calls to the same protocol', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.example.com:3128';
    const fetchWithProxy = await freshFetchWithProxy();

    await fetchWithProxy('https://graph.microsoft.com/beta/a');
    await fetchWithProxy('https://graph.microsoft.com/beta/b');

    const agentA = (fetchMock.mock.calls[0][1] as { agent?: unknown })?.agent;
    const agentB = (fetchMock.mock.calls[1][1] as { agent?: unknown })?.agent;
    expect(agentA).toBe(agentB);
  });

  it('lets an explicitly passed agent override proxy resolution', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.example.com:3128';
    const fetchWithProxy = await freshFetchWithProxy();
    const explicitAgent = { custom: true };

    await fetchWithProxy('https://graph.microsoft.com/beta/a', { agent: explicitAgent as never });

    expect(fetchMock).toHaveBeenCalledWith('https://graph.microsoft.com/beta/a', {
      agent: explicitAgent,
    });
  });
});
