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
const item = (): Win32CartItem => ({
  id: 'curated', addedAt: '2026-10-05', appSource: 'win32', sourceType: 'curated', curatedReleaseId: 'release', curatedSettingsMode: 'tested-defaults',
  wingetId: 'IntuneGet.Curated.FirefoxESR', displayName: 'Firefox ESR', publisher: 'Mozilla', version: '140.17.0',
  architecture: 'x64', installScope: 'machine', installerType: 'msi', installerUrl: 'https://example.test/firefox.msi', installerSha256: 'a'.repeat(64),
  installCommand: 'install', uninstallCommand: 'uninstall', detectionRules: [], psadtConfig: structuredClone(DEFAULT_PSADT_CONFIG),
  assignments: [{ type: 'allDevices', intent: 'required' }],
});
async function render(cart: Win32CartItem) {
  useCartStore.setState({ items: [cart] });
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root.render(createElement(CartItemConfig, { item: cart, onClose: vi.fn() })));
}
const radios = () => [...document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="curated-settings"]')];
const save = () => [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Save Changes'))!.click();
describe('curated deployment settings choice', () => {
  it('selects tested defaults initially and makes custom behaviour an explicit opt-in', async () => {
    await render(item());
    expect(radios()[0].checked).toBe(true);
    expect(document.body.textContent).not.toContain('Installation Behavior');
    await act(async () => radios()[1].click());
    expect(document.body.textContent).toContain('Installation Behavior');
    await act(async () => save());
    expect(useCartStore.getState().items[0]).toMatchObject({ curatedSettingsMode: 'custom' });
  });
  it('restores verified execution defaults while preserving branding and assignments', async () => {
    const cart = item(); cart.curatedSettingsMode = 'custom';
    cart.psadtConfig = { ...cart.psadtConfig, deployMode: 'Auto', brandingCompanyName: 'Example Company', processesToClose: [{ name: 'firefox', description: '' }] };
    await render(cart);
    await act(async () => radios()[0].click());
    await act(async () => save());
    expect(useCartStore.getState().items[0]).toMatchObject({ curatedSettingsMode: 'tested-defaults', assignments: cart.assignments,
      psadtConfig: { deployMode: DEFAULT_PSADT_CONFIG.deployMode, processesToClose: [], brandingCompanyName: 'Example Company' } });
  });
  it('preserves legacy custom settings until the user chooses tested defaults', async () => {
    const cart = item(); delete cart.curatedSettingsMode;
    cart.psadtConfig.processesToClose = [{ name: 'firefox', description: '' }];
    await render(cart);
    expect(radios()[1].checked).toBe(true);
    await act(async () => save());
    expect(useCartStore.getState().items[0]).toMatchObject({ curatedSettingsMode: 'custom', psadtConfig: { processesToClose: cart.psadtConfig.processesToClose } });
  });
});
