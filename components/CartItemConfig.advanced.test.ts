// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
});
vi.mock('@/components/providers/UserSettingsProvider', () => ({ useUserSettings: () => ({ settings: {} }) }));
vi.mock('@/components/AssignmentConfig', () => ({ AssignmentConfig: () => null }));
vi.mock('@/components/CategoryConfig', () => ({ CategoryConfig: () => null }));
vi.mock('@/components/DependencyConfig', () => ({ DependencyConfig: () => null }));
vi.mock('@/components/EspProfileSelector', () => ({ EspProfileSelector: () => null }));
vi.mock('@/components/updates/CartUpdatePolicyPicker', () => ({ CartUpdatePolicyPicker: () => null }));
import { CartItemConfig } from './CartItemConfig';
import { useCartStore } from '@/stores/cart-store';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { Win32CartItem } from '@/types/upload';

let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ''; });

// A winget item as created by the catalog "Select" quick add.
const item = (): Win32CartItem => ({
  id: 'edge', addedAt: '2026-10-10', appSource: 'win32',
  wingetId: 'Microsoft.Edge', displayName: 'Microsoft Edge', publisher: 'Microsoft', version: '149.0.4022.98',
  description: 'Microsoft Edge browser, based on the Chromium open source browser.',
  architecture: 'x64', installScope: 'machine', installerType: 'wix', installerUrl: 'https://example.test/edge.msi', installerSha256: 'a'.repeat(64),
  installCommand: 'msiexec /i "edge.msi" /qn', uninstallCommand: 'msiexec /x "{GUID}" /qn', detectionRules: [],
  psadtConfig: structuredClone(DEFAULT_PSADT_CONFIG),
});

async function render(cart: Win32CartItem) {
  useCartStore.setState({ items: [cart] });
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root.render(createElement(CartItemConfig, { item: cart, onClose: vi.fn() })));
}
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(label) || b.getAttribute('aria-label') === label)!;
const openAdvanced = () => act(async () => button('Advanced Options').click());
const save = () => act(async () => button('Save Changes').click());
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const descriptionField = () => document.querySelector<HTMLTextAreaElement>('#cart-description-override')!;

describe('cart item advanced options (#162)', () => {
  it('offers the same advanced options as the catalog deployment configuration', async () => {
    await render(item());
    await openAdvanced();
    const text = document.body.textContent;
    expect(text).toContain('Description override');
    expect(text).toContain('Install command override');
    expect(text).toContain('Uninstall command override');
    expect(text).toContain('Post-install commands');
    expect(text).toContain('Post-uninstall commands');
    expect(descriptionField().value).toBe(item().description);
  });

  it('saves post-install and post-uninstall commands and a description override', async () => {
    await render(item());
    await openAdvanced();
    await act(async () => button('Add post-install command').click());
    await act(async () => button('Add post-uninstall command').click());
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Post-install command 1"]')!, 'cmd.exe /c del "%Public%\\Desktop\\Microsoft Edge.lnk"');
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Post-uninstall command 1"]')!, 'cmd.exe /c rmdir /s /q "C:\\ProgramData\\Edge"');
    await type(descriptionField(), '  Company browser  ');
    await save();
    expect(useCartStore.getState().items[0]).toMatchObject({
      description: 'Company browser',
      psadtConfig: {
        postInstallCommands: ['cmd.exe /c del "%Public%\\Desktop\\Microsoft Edge.lnk"'],
        postUninstallCommands: ['cmd.exe /c rmdir /s /q "C:\\ProgramData\\Edge"'],
      },
    });
  });

  it('shows and preserves commands configured before the app was added', async () => {
    const cart = item();
    cart.psadtConfig = { ...cart.psadtConfig, postInstallCommands: ['first', 'second'] };
    await render(cart);
    await openAdvanced();
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[aria-label^="Post-install command"]')];
    expect(inputs.map(input => input.value)).toEqual(['first', 'second']);
    await act(async () => button('Remove command').click());
    await save();
    expect(useCartStore.getState().items[0]).toMatchObject({ psadtConfig: { postInstallCommands: ['second'] } });
  });

  it('keeps the current description when the override is cleared', async () => {
    await render(item());
    await openAdvanced();
    await type(descriptionField(), '   ');
    await save();
    expect(useCartStore.getState().items[0].description).toBe(item().description);
  });
});
