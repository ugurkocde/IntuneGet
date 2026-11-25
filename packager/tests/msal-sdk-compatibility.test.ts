import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfidentialClientApplication, type INetworkModule } from '@azure/msal-node';

const authority = 'https://login.fixture.invalid/fixture-tenant';
const metadata = JSON.stringify({
  authorization_endpoint: `${authority}/oauth2/v2.0/authorize`,
  token_endpoint: `${authority}/oauth2/v2.0/token`,
  issuer: `${authority}/v2.0`,
  end_session_endpoint: `${authority}/oauth2/v2.0/logout`,
  jwks_uri: `${authority}/discovery/v2.0/keys`,
});

afterEach(() => vi.restoreAllMocks());

describe('real MSAL SDK compatibility without authentication or network access', () => {
  it('exports the confidential client through ESM and CJS', () => {
    const require = createRequire(import.meta.url);
    expect(typeof ConfidentialClientApplication).toBe('function');
    expect(typeof require('@azure/msal-node').ConfidentialClientApplication).toBe('function');
  });

  it('uses the supplied network module, retains .default scopes and caches the token', async () => {
    const post = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: { access_token: 'fixture-access-token', expires_in: 3600, token_type: 'Bearer' },
    }));
    const get = vi.fn(async () => { throw new Error('Unexpected discovery request'); });
    const networkClient = { sendGetRequestAsync: get, sendPostRequestAsync: post } as INetworkModule;
    const sdk = new ConfidentialClientApplication({
      auth: {
        clientId: 'fixture-client',
        clientSecret: 'fixture-secret',
        authority,
        knownAuthorities: ['login.fixture.invalid'],
        authorityMetadata: metadata,
      },
      system: { networkClient },
    });
    const request = { scopes: ['https://graph.microsoft.com/.default'] };
    expect((await sdk.acquireTokenByClientCredential(request))?.accessToken).toBe('fixture-access-token');
    expect((await sdk.acquireTokenByClientCredential(request))?.accessToken).toBe('fixture-access-token');
    expect(get).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    const [url, options] = post.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe(`${authority}/oauth2/v2.0/token`);
    const form = new URLSearchParams(options.body);
    expect(form.get('scope')).toContain('https://graph.microsoft.com/.default');
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_secret')).toBe('fixture-secret');
  });
});
