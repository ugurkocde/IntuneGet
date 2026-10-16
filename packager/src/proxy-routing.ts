import fetch, { type RequestInfo, type RequestInit } from 'node-fetch';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent } from 'node:http';
import { Readable } from 'node:stream';

function hostname(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function bypasses(url: URL, entries: string[]): boolean {
  const host = hostname(url.hostname);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return entries.some(entry => {
    if (entry === '*') return true;
    const bracketed = entry.match(/^\[([^\]]+)\](?::(\d+))?$/);
    const singleColon = entry.match(/^([^:]+):(\d+)$/);
    const match = bracketed || singleColon;
    if (match?.[2] && match[2] !== port) return false;
    const domain = hostname(match?.[1] ?? entry).replace(/^\*?\./, '');
    return host === domain || (!host.includes(':') && host.endsWith('.' + domain));
  });
}

/** One routing snapshot, created after loading the operator's environment. */
export class ProxyRouting {
  private readonly proxies: Partial<Record<'http:' | 'https:', URL>> = {};
  private readonly agents = new Map<string, Agent>();
  private readonly exclusions: string[];

  constructor(env: Record<string, string | undefined>) {
    this.exclusions = (env.no_proxy || env.NO_PROXY || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    for (const protocol of ['http:', 'https:'] as const) {
      const key = protocol.slice(0, -1) + '_proxy';
      const value = env[key] || env[key.toUpperCase()];
      if (!value) continue;
      try {
        const parsed = new URL(value.includes('://') ? value : 'http://' + value);
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.search || parsed.hash || parsed.pathname !== '/') {
          throw new Error('Invalid proxy');
        }
        this.proxies[protocol] = parsed;
      } catch {
        // Never include a proxy URL or the parser's message: userinfo may be secret.
        throw new Error('Invalid ' + key.toUpperCase() + ': expected an HTTP or HTTPS proxy origin');
      }
    }
  }

  readonly agentFor = (url: URL): Agent | undefined => {
    const protocol = url.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return undefined;
    const proxy = this.proxies[protocol];
    if (!proxy || bypasses(url, this.exclusions)) return undefined;
    let agent = this.agents.get(protocol);
    if (!agent) {
      // Agent constructors can include their URL in opt-in debug output.
      // Keep credentials out of that URL and supply them only as a proxy header.
      const endpoint = new URL(proxy);
      const authorization = endpoint.username || endpoint.password
        ? 'Basic ' + Buffer.from(decodeURIComponent(endpoint.username) + ':' + decodeURIComponent(endpoint.password)).toString('base64') : undefined;
      endpoint.username = '';
      endpoint.password = '';
      const options = { headers: () => authorization ? { 'Proxy-Authorization': authorization } : {} };
      agent = protocol === 'https:' ? new HttpsProxyAgent(endpoint, options) : new HttpProxyAgent(endpoint, options);
      this.agents.set(protocol, agent);
    }
    return agent;
  };

  get enabled(): boolean {
    return Object.keys(this.proxies).length > 0;
  }

  fetch(input: RequestInfo | URL, init: RequestInit = {}) {
    // The callback is evaluated for every redirect, including a protocol change.
    return fetch(input, this.enabled ? { ...init, agent: this.agentFor } : init);
  }

  /** Fetch adapter for JSON API clients that use the platform Fetch types. */
  readonly webFetch: typeof globalThis.fetch = async (input, init) => {
    if (!this.enabled) return globalThis.fetch(input, init);
    const request = new Request(input, init);
    const response = await this.fetch(request.url, {
      method: request.method,
      headers: Array.from(request.headers.entries()),
      signal: request.signal,
      redirect: request.redirect,
      body: request.body === null ? undefined : Buffer.from(await request.arrayBuffer()),
    });
    const noBody = request.method === 'HEAD' || [204, 205, 304].includes(response.status);
    return new Response(!noBody && response.body ? Readable.toWeb(response.body as Readable) as ReadableStream<Uint8Array> : null, {
      status: response.status,
      statusText: response.statusText,
      headers: Array.from(response.headers.entries()),
    });
  };

  close(): void {
    for (const agent of this.agents.values()) agent.destroy();
    this.agents.clear();
  }
}
