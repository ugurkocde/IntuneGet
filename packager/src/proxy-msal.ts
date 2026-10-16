import { AuthError, ClientAuthErrorCodes, type INetworkModule, type NetworkRequestOptions, type NetworkResponse } from '@azure/msal-node';
import { ProxyRouting } from './proxy-routing.js';

/** Only replaces HTTP routing; MSAL still owns token acquisition and caching. */
export class ProxyMsalNetwork implements INetworkModule {
  constructor(private readonly routing: ProxyRouting) {}

  sendGetRequestAsync<T>(url: string, options?: NetworkRequestOptions, timeout?: number): Promise<NetworkResponse<T>> {
    return this.request<T>(url, 'GET', options, timeout);
  }

  sendPostRequestAsync<T>(url: string, options?: NetworkRequestOptions): Promise<NetworkResponse<T>> {
    return this.request<T>(url, 'POST', options);
  }

  private async request<T>(url: string, method: 'GET' | 'POST', options?: NetworkRequestOptions, timeout?: number): Promise<NetworkResponse<T>> {
    const controller = new AbortController();
    const timer = timeout ? setTimeout(() => controller.abort(), timeout) : undefined;
    let response;
    try {
      response = await this.routing.fetch(url, {
        method,
        headers: options?.headers,
        body: method === 'POST' ? options?.body || '' : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      // Do not forward proxy URLs, userinfo or raw underlying error messages.
      throw new AuthError(ClientAuthErrorCodes.networkError, '', error instanceof Error && error.name === 'AbortError' ? 'Request timeout' : 'Network request failed through configured proxy');
    } finally {
      if (timer) clearTimeout(timer);
    }
    try {
      return {status: response.status, headers: Object.fromEntries(response.headers.entries()), body: await response.json() as T};
    } catch {
      throw new AuthError(ClientAuthErrorCodes.tokenParsingError, '', 'Failed to parse response');
    }
  }
}
