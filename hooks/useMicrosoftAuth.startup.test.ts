// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// MSAL as a returning user's browser presents it: a stored active account
// that cannot be read until initialization has finished.
const msal = vi.hoisted(() => ({
  inProgress: 'startup',
  initialized: false,
  storedAccount: { homeAccountId: 'home-a', localAccountId: 'user-a', tenantId: 'tenant-a', username: 'a@example.test', name: 'A' },
  accounts: [] as unknown[],
  lookups: 0,
  silent: vi.fn(),
}));

vi.mock('@azure/msal-react', () => {
  const instance = {
    getActiveAccount: () => {
      msal.lookups += 1;
      if (!msal.initialized) {
        throw Object.assign(new Error('uninitialized_public_client_application'), {
          errorCode: 'uninitialized_public_client_application',
        });
      }
      return msal.storedAccount;
    },
    acquireTokenSilent: msal.silent,
  };
  return {
    useMsal: () => ({ instance, accounts: msal.accounts, inProgress: msal.inProgress }),
    useIsAuthenticated: () => msal.accounts.length > 0,
  };
});
vi.mock('@/lib/msal-config', () => ({ graphScopes: ['fixture.read'], getAdminConsentUrl: vi.fn() }));

import { useMicrosoftAuth } from './useMicrosoftAuth';

let root: Root;
let auth: ReturnType<typeof useMicrosoftAuth>;
function Probe() {
  const value = useMicrosoftAuth();
  useLayoutEffect(() => { auth = value; });
  return null;
}
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render() {
  await act(async () => root.render(createElement(Probe)));
}

beforeEach(() => {
  msal.inProgress = 'startup';
  msal.initialized = false;
  msal.accounts = [];
  msal.lookups = 0;
  msal.silent.mockResolvedValue({ accessToken: 'fixture-token', expiresOn: new Date(Date.now() + 3600000) });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

it('renders for a returning user while MSAL is still starting', async () => {
  await render();

  expect(msal.lookups).toBe(0);
  expect(auth.isInitializing).toBe(true);
  expect(auth.account).toBeNull();
  expect(auth.user).toBeNull();
  expect(await auth.getAccessToken()).toBeNull();
});

it('picks up the stored account once MSAL has started', async () => {
  await render();

  msal.initialized = true;
  msal.inProgress = 'none';
  msal.accounts = [msal.storedAccount];
  await render();

  expect(auth.isInitializing).toBe(false);
  expect(auth.account).toBe(msal.storedAccount);
  expect(auth.user?.id).toBe('user-a');
  expect(await auth.getAccessToken()).toBe('fixture-token');
});

it('falls back to the known accounts when the lookup fails after startup', async () => {
  msal.inProgress = 'none';
  msal.accounts = [msal.storedAccount];
  await render();

  expect(msal.lookups).toBeGreaterThan(0);
  expect(auth.account).toBe(msal.storedAccount);
});
