import fetch, { type RequestInfo, type RequestInit } from 'node-fetch';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent } from 'node:http';

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
      agent = protocol === 'https:' ? new HttpsProxyAgent(proxy) : new HttpProxyAgent(proxy);
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

  close(): void {
    for (const agent of this.agents.values()) agent.destroy();
    this.agents.clear();
  }
}
