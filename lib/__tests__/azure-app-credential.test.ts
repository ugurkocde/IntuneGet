import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }));

vi.mock('@azure/identity', () => ({
  ManagedIdentityCredential: class {
    getToken = getTokenMock;
  },
}));

import { acquireAppOnlyToken, isManagedIdentityMode } from '@/lib/azure-app-credential';

const ENV_KEYS = [
  'AZURE_AUTH_MODE',
  'AZURE_MANAGED_IDENTITY_CLIENT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_AD_CLIENT_ID',
  'NEXT_PUBLIC_AZURE_AD_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_AD_CLIENT_SECRET',
] as const;

describe('azure-app-credential', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('mode detection', () => {
    it('defaults to secret mode', () => {
      expect(isManagedIdentityMode()).toBe(false);
    });
    it('detects managed-identity mode (case-insensitive)', () => {
      process.env.AZURE_AUTH_MODE = 'Managed-Identity';
      expect(isManagedIdentityMode()).toBe(true);
    });
  });

  describe('secret mode', () => {
    it('returns missing_credentials when no client id/secret', async () => {
      const r = await acquireAppOnlyToken('tenant-1');
      expect(r).toEqual({ ok: false, error: 'missing_credentials' });
    });

    it('acquires a token via client credentials and does not invoke managed identity', async () => {
      process.env.AZURE_CLIENT_ID = 'client-123';
      process.env.AZURE_CLIENT_SECRET = 'super-secret';
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3599 }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const r = await acquireAppOnlyToken('tenant-1');
      expect(r).toEqual({ ok: true, accessToken: 'tok', expiresIn: 3599 });
      expect(getTokenMock).not.toHaveBeenCalled();

      // Per-tenant authority + secret body.
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
      expect(init.body).toContain('client_secret=super-secret');
      expect(init.body).toContain('grant_type=client_credentials');

      vi.unstubAllGlobals();
    });

    it('classifies an invalid client secret as missing_credentials', async () => {
      process.env.AZURE_CLIENT_ID = 'client-123';
      process.env.AZURE_CLIENT_SECRET = 'bad';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'invalid_client', error_description: 'AADSTS7000215 bad secret' }),
      }));
      const r = await acquireAppOnlyToken('tenant-1');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('missing_credentials');
      vi.unstubAllGlobals();
    });

    it('classifies missing consent as consent_not_granted', async () => {
      process.env.AZURE_CLIENT_ID = 'client-123';
      process.env.AZURE_CLIENT_SECRET = 'secret';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'unauthorized_client', error_description: 'AADSTS65001 not consented' }),
      }));
      const r = await acquireAppOnlyToken('tenant-1');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('consent_not_granted');
      vi.unstubAllGlobals();
    });
  });

  describe('managed-identity mode', () => {
    beforeEach(() => {
      process.env.AZURE_AUTH_MODE = 'managed-identity';
    });

    it('acquires a token from the managed identity (no fetch)', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      getTokenMock.mockResolvedValueOnce({
        token: 'mi-token',
        expiresOnTimestamp: Date.now() + 3600_000,
      });

      const r = await acquireAppOnlyToken('tenant-ignored');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.accessToken).toBe('mi-token');
        expect(r.expiresIn).toBeGreaterThan(3000);
      }
      expect(getTokenMock).toHaveBeenCalledWith('https://graph.microsoft.com/.default');
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('maps CredentialUnavailableError to missing_credentials', async () => {
      const err = Object.assign(new Error('no managed identity'), { name: 'CredentialUnavailableError' });
      getTokenMock.mockRejectedValueOnce(err);
      const r = await acquireAppOnlyToken('tenant-1');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('missing_credentials');
    });

    it('maps other errors to network_error', async () => {
      getTokenMock.mockRejectedValueOnce(new Error('imds timeout'));
      const r = await acquireAppOnlyToken('tenant-1');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('network_error');
    });
  });
});
