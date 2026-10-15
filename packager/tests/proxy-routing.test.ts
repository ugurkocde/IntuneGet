import { describe, expect, it } from 'vitest';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyRouting } from '../src/proxy-routing.js';

describe('proxy route selection', () => {
  it('chooses per protocol, gives lowercase precedence and reuses bounded agents', () => {
    const routes = new ProxyRouting({http_proxy:'http://proxy.invalid:3128', https_proxy:'http://secure.invalid:3128', HTTPS_PROXY:'http://ignored.invalid:3128'});
    const plain = routes.agentFor(new URL('http://service.invalid'));
    const secure = routes.agentFor(new URL('https://service.invalid'));
    expect(plain).toBeInstanceOf(HttpProxyAgent);
    expect(secure).toBeInstanceOf(HttpsProxyAgent);
    expect((secure as HttpsProxyAgent<string>).proxy.hostname).toBe('secure.invalid');
    expect(routes.agentFor(new URL('https://other.invalid'))).toBe(secure);
    routes.close();
  });
  it.each(['example.test','.example.test','*.example.test'])('bypasses label boundaries for %s', exclusion => {
    const routes = new ProxyRouting({HTTPS_PROXY:'proxy.invalid:3128', NO_PROXY:exclusion});
    expect(routes.agentFor(new URL('https://example.test'))).toBeUndefined();
    expect(routes.agentFor(new URL('https://sub.example.test'))).toBeUndefined();
    expect(routes.agentFor(new URL('https://badexample.test'))).toBeInstanceOf(HttpsProxyAgent);
    routes.close();
  });
  it('handles effective ports and bracketed IPv6 without cross scheme fallback', () => {
    const routes = new ProxyRouting({HTTPS_PROXY:'http://proxy.invalid', NO_PROXY:'example.test:443,[::1]:8443'});
    expect(routes.agentFor(new URL('https://example.test'))).toBeUndefined();
    expect(routes.agentFor(new URL('https://[::1]:8443'))).toBeUndefined();
    expect(routes.agentFor(new URL('https://example.test:8443'))).toBeDefined();
    expect(routes.agentFor(new URL('http://example.test:8443'))).toBeUndefined();
    routes.close();
  });
  it('supports wildcard bypass and redacts invalid configuration', () => {
    const routes = new ProxyRouting({HTTP_PROXY:'http://proxy.invalid', NO_PROXY:'*'});
    expect(routes.agentFor(new URL('http://example.test'))).toBeUndefined();
    expect(() => new ProxyRouting({HTTPS_PROXY:'socks5://secret:password@proxy.invalid'})).toThrow(/^Invalid HTTPS_PROXY: expected/);
    routes.close();
  });
});
