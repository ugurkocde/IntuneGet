// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { InteractionStatus } from '@azure/msal-browser';
import { cachedAccount, createMsalTestDouble } from '@/test-utils/msal-test-double';
const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import('@/test-utils/msal-test-double').createMsalTestDouble> }));
vi.mock('@azure/msal-react', () => ({
  useMsal: () => state.client.context,
  useIsAuthenticated: () => state.client.context.accounts.length > 0,
}));
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
  state.client = createMsalTestDouble();
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

  expect(state.client.instance.getActiveAccount.mock.calls.length).toBe(0);
  expect(auth.isInitializing).toBe(true);
  expect(auth.account).toBeNull();
  expect(auth.user).toBeNull();
  expect(await auth.getAccessToken()).toBeNull();
});

it('picks up the stored account once MSAL has started', async () => {
  await render();

  const initialization = state.client.instance.initialize();
  state.client.finishInitialization();
  await initialization;
  await render();

  expect(auth.isInitializing).toBe(false);
  expect(auth.account).toBe(cachedAccount);
  expect(auth.user?.id).toBe('user-a');
  expect(await auth.getAccessToken()).toBe('fixture-token');
});

it('falls back to the known accounts when the lookup fails after startup', async () => {
  state.client.context.inProgress = InteractionStatus.None;
  state.client.context.accounts = [cachedAccount];
  await render();

  expect(state.client.instance.getActiveAccount.mock.calls.length).toBeGreaterThan(0);
  expect(auth.account).toBe(cachedAccount);
});
