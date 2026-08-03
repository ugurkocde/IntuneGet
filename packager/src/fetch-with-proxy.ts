/**
 * Proxy-aware wrapper around node-fetch.
 *
 * node-fetch does not read HTTP_PROXY/HTTPS_PROXY (unlike Node's built-in
 * fetch/undici with NODE_USE_ENV_PROXY=1), so every outbound call - Graph
 * API, installer/tool downloads, Azure Storage uploads - bypassed the proxy
 * and failed with ECONNREFUSED on hosts that only have proxied internet
 * access. This resolves a single proxy agent from the environment once and
 * reuses it for every request.
 */

import type { RequestInit, Response } from 'node-fetch';

const agentPromises: { http: Promise<unknown> | null; https: Promise<unknown> | null } = {
  http: null,
  https: null,
};

export async function resolveProxyAgent(targetUrl: string): Promise<unknown> {
  const isHttps = targetUrl.startsWith('https:');
  const proxyUrl = isHttps
    ? process.env.HTTPS_PROXY || process.env.https_proxy
    : process.env.HTTP_PROXY || process.env.http_proxy;

  if (!proxyUrl) {
    return undefined;
  }

  const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  const host = new URL(targetUrl).hostname;
  const bypassed = noProxy
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => host === entry || host.endsWith(`.${entry.replace(/^\./, '')}`));

  if (bypassed) {
    return undefined;
  }

  const protocol = isHttps ? 'https' : 'http';
  if (!agentPromises[protocol]) {
    agentPromises[protocol] = isHttps
      ? import('https-proxy-agent').then((mod) => new mod.HttpsProxyAgent(proxyUrl))
      : import('http-proxy-agent').then((mod) => new mod.HttpProxyAgent(proxyUrl));
  }

  return agentPromises[protocol];
}

export async function fetchWithProxy(url: string, init: RequestInit = {}): Promise<Response> {
  const fetch = (await import('node-fetch')).default;
  const agent = init.agent ?? (await resolveProxyAgent(url));

  return fetch(url, agent ? { ...init, agent: agent as never } : init);
}
