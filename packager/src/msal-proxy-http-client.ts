/**
 * Proxy-aware INetworkModule for msal-node.
 *
 * msal-node's default HttpClient calls Node's built-in fetch directly with
 * no agent. That only honors HTTP_PROXY/HTTPS_PROXY when NODE_USE_ENV_PROXY=1
 * is set on the process *before* the Node runtime initializes its network
 * stack - setting it via a .env file loaded at startup (dotenv.config(), which
 * runs after Node has already started) is too late and gets silently ignored,
 * so token acquisition fails with "Network request failed: fetch failed"
 * even with the proxy vars set. Route it through the same node-fetch +
 * proxy-agent path used by fetchWithProxy() instead, which resolves the
 * agent from the environment at call time regardless of when it was set.
 */

import type { INetworkModule, NetworkRequestOptions, NetworkResponse } from '@azure/msal-node';
import { fetchWithProxy } from './fetch-with-proxy.js';

export class ProxyHttpClient implements INetworkModule {
  async sendGetRequestAsync<T>(
    url: string,
    options?: NetworkRequestOptions
  ): Promise<NetworkResponse<T>> {
    return this.sendRequest<T>(url, 'GET', options);
  }

  async sendPostRequestAsync<T>(
    url: string,
    options?: NetworkRequestOptions
  ): Promise<NetworkResponse<T>> {
    return this.sendRequest<T>(url, 'POST', options);
  }

  private async sendRequest<T>(
    url: string,
    method: 'GET' | 'POST',
    options?: NetworkRequestOptions
  ): Promise<NetworkResponse<T>> {
    const response = await fetchWithProxy(url, {
      method,
      headers: options?.headers,
      body: method === 'POST' ? options?.body || '' : undefined,
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      headers,
      body: (await response.json()) as T,
      status: response.status,
    };
  }
}
