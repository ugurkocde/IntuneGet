// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const h = vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void; token: string; body?: unknown };
  return {
    values,
    auth: { isAuthenticated: true, isInitializing: false, account: { homeAccountId: 'a', localAccountId: 'a', tenantId: 't1' } as null | Record<string, string>, token: 'token-a' },
    gets: [] as Deferred[],
    patches: [] as Deferred[],
    getAccessToken: async () => '',
    nextToken: null as Promise<string> | null,
  };
});

vi.mock('@/hooks/useMicrosoftAuth', () => ({
  useMicrosoftAuth: () => ({
    isAuthenticated: h.auth.isAuthenticated,
    isInitializing: h.auth.isInitializing,
    account: h.auth.account,
    getAccessToken: h.getAccessToken,
  }),
}));
vi.mock('@/lib/user-settings', () => ({
  getUserSettings: (token: string) => new Promise((resolve, reject) => h.gets.push({ resolve, reject, token })),
  patchUserSettings: (token: string, body: unknown) => new Promise((resolve, reject) => h.patches.push({ resolve, reject, token, body })),
}));

import { DEFAULT_USER_SETTINGS } from '@/types/user-settings';
import { UserSettingsProvider, useUserSettings } from './UserSettingsProvider';

h.getAccessToken = async () => h.nextToken ?? h.auth.token;
let root: Root;
let latest: ReturnType<typeof useUserSettings>;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function capture(value: ReturnType<typeof useUserSettings>) {
  latest = value;
}
function Probe() {
  const value = useUserSettings();
  useEffect(() => capture(value));
  return null;
}
async function render() {
  await act(async () => root.render(createElement(UserSettingsProvider, null, createElement(Probe))));
}
const response = (packageDefaults: unknown) => ({ settings: { ...DEFAULT_USER_SETTINGS, packageDefaults }, hasStoredSettings: true });
const accountA = { homeAccountId: 'a', localAccountId: 'a', tenantId: 't1' };
const accountB = { homeAccountId: 'b', localAccountId: 'b', tenantId: 't2' };

beforeEach(() => {
  h.getAccessToken = async () => h.nextToken ?? h.auth.token;
  h.values.clear();
  h.gets.length = 0;
  h.patches.length = 0;
  h.nextToken = null;
  Object.assign(h.auth, { isAuthenticated: true, isInitializing: false, account: accountA, token: 'token-a' });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

describe('package defaults in the settings provider', () => {
  it.each(['success', 'failure'])('preserves a successful save when an earlier same-account reload ends in %s', async (outcome) => {
    await render();
    await act(async () => h.gets[0].resolve(response({ deployMode: 'Auto' })));
    h.getAccessToken = async () => h.auth.token;
    await render();
    expect(h.gets).toHaveLength(2);
    expect(latest.isLoading).toBe(true);
    await act(async () => {
      const saving = latest.savePackageDefaults({ deployMode: 'Silent' });
      await Promise.resolve();
      h.patches[0].resolve(response({ deployMode: 'Silent' }));
      await saving;
    });
    expect(latest.isLoading).toBe(true);
    await act(async () => {
      if (outcome === 'success') h.gets[1].resolve(response({ deployMode: 'Auto' }));
      else h.gets[1].reject(new Error('Older reload failed'));
    });
    expect(latest.packageDefaults).toEqual({ deployMode: 'Silent' });
    expect(latest.packageDefaultsStatus).toBe('loaded');
    expect(latest.isLoading).toBe(false);
  });

  it.each(['success', 'failure'])('ignores an older overlapping load %s after the latest load succeeds', async (outcome) => {
    await render();
    h.getAccessToken = async () => h.auth.token;
    await render();
    expect(h.gets).toHaveLength(2);
    await act(async () => h.gets[1].resolve(response({ deployMode: 'Auto' })));
    await act(async () => {
      if (outcome === 'success') h.gets[0].resolve(response({ deployMode: 'Silent' }));
      else h.gets[0].reject(new Error('Older request failed'));
    });
    expect(latest.packageDefaultsStatus).toBe('loaded');
    expect(latest.packageDefaults).toEqual({ deployMode: 'Auto' });
    expect(latest.isLoading).toBe(false);
  });
  it('advances scope once for a real account change in StrictMode', async () => {
    const strictRender = () => act(async () => root.render(createElement(StrictMode, null, createElement(UserSettingsProvider, null, createElement(Probe)))));
    await strictRender();
    const start = latest.packageDefaultsAccountScope;
    Object.assign(h.auth, { account: accountB, token: 'token-b' });
    await strictRender();
    expect(latest.packageDefaultsAccountScope).toBe(start + 1);
    await strictRender();
    expect(latest.packageDefaultsAccountScope).toBe(start + 1);
  });

  it('keeps an in-flight save valid for a fresh account object with the same ids', async () => {
    await render();
    await act(async () => h.gets[0].resolve(response(null)));
    let saving!: Promise<unknown>;
    await act(async () => { saving = latest.savePackageDefaults({ allowDefer: true }).catch((e) => e); });
    h.auth.account = { ...accountA };
    await render();
    let result: unknown;
    await act(async () => { h.patches[0].resolve(response({ allowDefer: true })); result = await saving; });
    expect(result).toBeUndefined();
    expect(latest.packageDefaults).toEqual({ allowDefer: true });
  });

  it('exposes a failed load separately from an empty saved defaults value', async () => {
    await render();
    expect(latest.packageDefaultsStatus).toBe('loading');
    await act(async () => h.gets[0].reject(new Error('Network error')));
    expect(latest.packageDefaultsStatus).toBe('error');
    expect(latest.packageDefaults).toBeNull();
    Object.assign(h.auth, { account: accountB, token: 'token-b' });
    await render();
    expect(latest.packageDefaultsStatus).toBe('loading');
    await act(async () => h.gets[1].resolve(response(null)));
    expect(latest.packageDefaultsStatus).toBe('loaded');
  });

  it('marks defaults unavailable when token acquisition returns no token', async () => {
    h.auth.token = '';
    await render();
    expect(latest.packageDefaultsStatus).toBe('error');
    expect(h.gets).toHaveLength(0);
  });
  it('requires a fresh load when returning to a previously loaded account', async () => {
    await render();
    await act(async () => h.gets[0].resolve(response({ deployMode: 'Auto' })));
    Object.assign(h.auth, { account: accountB, token: 'token-b' });
    await render();
    Object.assign(h.auth, { account: accountA, token: 'token-a' });
    await render();
    expect(latest.packageDefaults).toBeNull();
    await act(async () => h.gets[2].resolve(response({ allowDefer: true })));
    expect(latest.packageDefaults).toEqual({ allowDefer: true });
  });

  it('does not send a defaults save after the account changes during token acquisition', async () => {
    await render();
    let resolveToken!: (token: string) => void;
    h.nextToken = new Promise<string>((resolve) => { resolveToken = resolve; });
    let result!: Promise<unknown>;
    await act(async () => { result = latest.savePackageDefaults({ allowDefer: true }).catch((error) => error); });
    h.nextToken = null;
    Object.assign(h.auth, { account: accountB, token: 'token-b' });
    await render();
    let error: unknown;
    await act(async () => { resolveToken('token-b'); error = await result; });
    expect(error).toBeInstanceOf(Error);
    expect(h.patches).toHaveLength(0);
    expect(latest.packageDefaults).toBeNull();
  });

  it('exposes null until the server load for the active account finishes', async () => {
    await render();
    expect(latest.packageDefaults).toBeNull();
    await act(async () => h.gets[0].resolve(response({ allowDefer: true })));
    expect(latest.packageDefaults).toEqual({ allowDefer: true });
  });

  it('ignores a load that finishes after switching accounts', async () => {
    await render();
    Object.assign(h.auth, { account: accountB, token: 'token-b' });
    await render();
    const [loadA, loadB] = h.gets;
    await act(async () => loadA.resolve(response({ deployMode: 'Auto' })));
    expect(latest.packageDefaults).toBeNull();
    await act(async () => loadB.resolve(response({ allowDefer: false })));
    expect(latest.packageDefaults).toEqual({ allowDefer: false });
  });

  it('clears defaults after an account switch and after sign out', async () => {
    await render();
    await act(async () => h.gets[0].resolve(response({ allowDefer: true })));
    Object.assign(h.auth, { account: accountB, token: 'token-b' });
    await render();
    expect(latest.packageDefaults).toBeNull();
    Object.assign(h.auth, { isAuthenticated: false, account: null });
    await render();
    expect(latest.packageDefaults).toBeNull();
  });

  it('ignores a save that finishes after switching accounts', async () => {
    await render();
    await act(async () => h.gets[0].resolve(response(null)));
    let saving!: Promise<unknown>;
    await act(async () => { saving = latest.savePackageDefaults({ allowDefer: true }).catch((e) => e); });
    expect(h.patches[0].body).toEqual({ packageDefaults: { allowDefer: true } });
    Object.assign(h.auth, { account: accountB, token: 'token-b' });
    await render();
    await act(async () => { h.patches[0].resolve(response({ allowDefer: true })); await saving; });
    expect(latest.packageDefaults).toBeNull();
  });

  it('reports a failed save and keeps the previous defaults', async () => {
    await render();
    await act(async () => h.gets[0].resolve(response({ deployMode: 'Auto' })));
    let result: unknown;
    await act(async () => {
      const saving = latest.savePackageDefaults(null).catch((e: Error) => e);
      await Promise.resolve();
      h.patches[0].reject(new Error('Saving user settings requires hosted services'));
      result = await saving;
    });
    expect(result).toBeInstanceOf(Error);
    expect(latest.packageDefaults).toEqual({ deployMode: 'Auto' });
  });

  it('never writes defaults to local storage or the legacy migration', async () => {
    h.values.set('intuneget-theme', 'dark');
    await render();
    await act(async () => h.gets[0].resolve({ settings: { ...DEFAULT_USER_SETTINGS, packageDefaults: { allowDefer: true } }, hasStoredSettings: false }));
    for (const value of h.values.values()) expect(value).not.toContain('allowDefer');
    for (const call of h.patches) expect(call.body).not.toHaveProperty('packageDefaults');
    expect(latest.settings).not.toHaveProperty('packageDefaults');
  });

  it('does not load while MSAL is still initializing with a cached account', async () => {
    Object.assign(h.auth, { isInitializing: true, account: accountA });
    h.getAccessToken = vi.fn(async () => {
      throw new Error('uninitialized_public_client_application');
    });
    await render();
    expect(h.getAccessToken).not.toHaveBeenCalled();
    expect(h.gets).toHaveLength(0);
    expect(latest.packageDefaults).toBeNull();
  });
});
