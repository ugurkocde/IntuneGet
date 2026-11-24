// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PackageDefaults } from '@/types/user-settings';

const mock = vi.hoisted(() => ({
  defaults: null as PackageDefaults | null,
  isLoading: false,
  packageDefaultsStatus: 'loaded',
  account: { homeAccountId: 'a', tenantId: 'one' },
  save: vi.fn(),
}));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ account: mock.account, isAuthenticated: true, isInitializing: false }) }));
vi.mock('@/components/providers/UserSettingsProvider', () => ({ useUserSettings: () => ({ packageDefaults: mock.defaults, packageDefaultsStatus: mock.packageDefaultsStatus, savePackageDefaults: mock.save, isLoading: mock.isLoading }) }));
import { PackageDefaultsSettings } from './PackageDefaultsSettings';

let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const render = () => act(async () => root.render(createElement(PackageDefaultsSettings)));
const input = (text: string) => {
  const label = Array.from(document.querySelectorAll('label')).find((element) => element.textContent?.includes(text));
  if (!label) throw new Error(`Missing label ${text}`);
  return label.querySelector('input') as HTMLInputElement;
};
beforeEach(() => {
  mock.defaults = null;
  mock.isLoading = false;
  mock.packageDefaultsStatus = 'loaded';
  mock.account = { homeAccountId: 'a', tenantId: 'one' };
  mock.save.mockReset().mockImplementation(async (value) => { mock.defaults = value; });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

it('locks the editor after a failed load instead of overwriting unseen defaults', async () => {
  mock.packageDefaultsStatus = 'error';
  await render();
  expect(input('Use saved package defaults').disabled).toBe(true);
  await act(async () => input('Use saved package defaults').click());
  expect(mock.save).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
});

it('clears the optional deferral days value', async () => {
  mock.defaults = { allowDefer: true, deferDays: 7 };
  await render();
  await act(async () => {
    const field = input('Deferral days'); field.value = ''; field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  expect(mock.save).toHaveBeenCalledOnce();
  expect(mock.save.mock.calls[0][0]).not.toHaveProperty('deferDays');
});

it('preserves the saved limit when a browser reports empty bad numeric input', async () => {
  mock.defaults = { allowDefer: true, deferDays: 7 };
  await render();
  await act(async () => {
    const field = input('Deferral days');
    field.value = '';
    Object.defineProperty(field, 'validity', { configurable: true, value: { badInput: true, valid: false } });
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  expect(mock.save).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Deferral days');
  expect(input('Deferral days').value).toBe('7');
});

it.each([['Deferral days', '400'], ['Close countdown in seconds', '']])('reports invalid %s without saving', async (label, value) => {
  mock.defaults = { allowDefer: true, deferDays: 7, closeCountdown: 60 };
  await render();
  await act(async () => {
    const field = input(label); field.value = value; field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  expect(mock.save).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(label);
  expect(input(label).value).toBe(label === 'Deferral days' ? '7' : '60');
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });

it('enables defaults with only allowed values and clears them explicitly', async () => {
  await render();
  await act(async () => input('Use saved package defaults').click());
  expect(mock.save).toHaveBeenCalledOnce();
  expect(mock.save.mock.calls[0][0]).toMatchObject({ deployMode: 'Silent' });
  expect(mock.save.mock.calls[0][0]).not.toHaveProperty('verifyInstall');
  expect(mock.save.mock.calls[0][0]).not.toHaveProperty('processesToClose');
  await render();
  await act(async () => input('Use saved package defaults').click());
  expect(mock.save).toHaveBeenLastCalledWith(null);
});

it('surfaces a hosted save failure without claiming success', async () => {
  mock.save.mockRejectedValueOnce(new Error('Saving user settings requires hosted services'));
  await render();
  await act(async () => input('Use saved package defaults').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('requires hosted services');
  expect(input('Use saved package defaults').checked).toBe(false);
});

it('disables changes while server settings load and shows explicit scope', async () => {
  mock.isLoading = true;
  await render();
  expect(input('Use saved package defaults').disabled).toBe(true);
  expect(document.body.textContent).toContain('Quick add and bulk add use the standard settings');
});

it('edits one preference while retaining the other saved values', async () => {
  mock.defaults = { deployMode: 'Auto', allowDefer: false, deferTimes: 8 };
  await render();
  await act(async () => input('Allow deferral').click());
  expect(mock.save).toHaveBeenLastCalledWith(expect.objectContaining({ deployMode: 'Auto', allowDefer: true, deferTimes: 8 }));
});

it('does not show a previous account save outcome after switching accounts', async () => {
  let finish!: () => void;
  mock.save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render();
  await act(async () => input('Use saved package defaults').click());
  mock.account = { homeAccountId: 'b', tenantId: 'two' };
  await render();
  await act(async () => finish());
  expect(document.body.textContent).not.toContain('Package defaults saved.');
  expect(document.body.textContent).not.toContain('Saving package defaults...');
});
