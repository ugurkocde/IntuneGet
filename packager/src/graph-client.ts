/**
 * Microsoft Graph API Client
 * Handles authentication and API requests to Microsoft Graph
 */

import { ConfidentialClientApplication } from '@azure/msal-node';
import { PackagerConfig } from './config.js';
import { createLogger, Logger } from './logger.js';

const GRAPH_ENDPOINT = 'https://graph.microsoft.com/beta';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

interface TokenCache {
  token: string;
  expiresAt: number;
}

export class GraphClient {
  private config: PackagerConfig;
  private tenantId: string;
  private msalClient: ConfidentialClientApplication;
  private tokenCache: TokenCache | null = null;
  private logger: Logger;

  constructor(config: PackagerConfig, tenantId: string) {
    this.config = config;
    this.tenantId = tenantId;
    this.logger = createLogger('GraphClient');

    this.msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: config.azure.clientId,
        clientSecret: config.azure.clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    });
  }

  /**
   * Get access token (with caching)
   */
  private async getAccessToken(): Promise<string> {
    // Check cache
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60000) {
      return this.tokenCache.token;
    }

    try {
      const result = await this.msalClient.acquireTokenByClientCredential({
        scopes: [GRAPH_SCOPE],
      });

      if (!result || !result.accessToken) {
        throw new Error('Failed to acquire access token');
      }

      // Cache the token
      this.tokenCache = {
        token: result.accessToken,
        expiresAt: result.expiresOn ? result.expiresOn.getTime() : Date.now() + 3600000,
      };

      this.logger.debug('Acquired new access token', { tenantId: this.tenantId });
      return result.accessToken;
    } catch (error) {
      this.logger.error('Failed to acquire access token', {
        tenantId: this.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Make a GET request to Graph API
   */
  async get<T = unknown>(path: string): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${GRAPH_ENDPOINT}${path}`;

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error('Graph API GET failed', {
        path,
        status: response.status,
        error: errorBody,
      });
      throw new Error(`Graph API GET failed: ${response.status} - ${errorBody}`);
    }

    return (await response.json()) as T;
  }

  /**
   * Make a POST request to Graph API
   */
  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${GRAPH_ENDPOINT}${path}`;

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error('Graph API POST failed', {
        path,
        status: response.status,
        error: errorBody,
      });
      throw new Error(`Graph API POST failed: ${response.status} - ${errorBody}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  /**
   * Make a PATCH request to Graph API
   */
  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${GRAPH_ENDPOINT}${path}`;

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error('Graph API PATCH failed', {
        path,
        status: response.status,
        error: errorBody,
      });
      throw new Error(`Graph API PATCH failed: ${response.status} - ${errorBody}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  /**
   * Make a DELETE request to Graph API
   */
  async delete(path: string): Promise<void> {
    const token = await this.getAccessToken();
    const url = `${GRAPH_ENDPOINT}${path}`;

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error('Graph API DELETE failed', {
        path,
        status: response.status,
        error: errorBody,
      });
      throw new Error(`Graph API DELETE failed: ${response.status} - ${errorBody}`);
    }
  }
}
