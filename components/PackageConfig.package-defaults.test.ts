// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { Win32CartItem } from '@/types/upload';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});

const manifestState = vi.hoisted(() => ({ data: undefined, isFetching: false, error: null as Error | null }));
vi.mock('@/hooks/use-packages', () => ({
  useLocaleVariants: () => ({ data: { variants: [] }, isSuccess: true }),
  usePackageManifest: () => manifestState,
}));
const settingsState = vi.hoisted(() => ({ packageDefaults: null as unknown, packageDefaultsStatus: 'loaded', accountScope: 0, save: vi.fn(async () => undefined) }));
vi.mock('@/components/providers/UserSettingsProvider', () => ({ useUserSettings: () => ({ settings: { carryOverAssignments: false }, packageDefaults: settingsState.packageDefaults, packageDefaultsStatus: settingsState.packageDefaultsStatus, packageDefaultsAccountScope: settingsState.accountScope, savePackageDefaults: settingsState.save }) }));
vi.mock('@/hooks/use-update-app-settings', () => ({ useUpdateAppSettings: () => ({ isUpdating: false }) }));
vi.mock('@/components/AppIcon', () => ({ AppIcon: () => null }));
vi.mock('@/components/AssignmentConfig', () => ({ AssignmentConfig: () => null }));
vi.mock('@/components/CategoryConfig', () => ({ CategoryConfig: () => null }));
vi.mock('@/components/DependencyConfig', () => ({ DependencyConfig: () => null }));
vi.mock('@/components/EspProfileSelector', () => ({ EspProfileSelector: () => null }));
vi.mock('@/components/updates/CartUpdatePolicyPicker', () => ({ CartUpdatePolicyPicker: () => null }));

import { PackageConfig } from './PackageConfig';
import { useCartStore } from '@/stores/cart-store';

let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const installer = { architecture: 'x64' as const, type: 'msi' as const, url: 'https://example.test/new.msi', sha256: 'B'.repeat(64), scope: 'machine' as const };
const pkg = { id: 'Example.App', name: 'Example App', publisher: 'Example', version: '1.0' };
const oldItem: Win32CartItem = {
  id: 'retained-cart-id', addedAt: '2026-07-09', appSource: 'win32', wingetId: 'Example.App',
  displayName: 'Example App', publisher: 'Example', version: '1.0', architecture: 'x64', installScope: 'machine',
  installerType: 'msi', installerUrl: 'https://example.test/old.msi', installerSha256: 'A'.repeat(64),
  installCommand: 'old command', uninstallCommand: 'old uninstall', detectionRules: [], forceCreate: true,
  psadtConfig: { ...DEFAULT_PSADT_CONFIG, deployMode: 'Silent', allowDefer: false, processesToClose: [] },
};
const defaults = { deployMode: 'NonInteractive', allowDefer: true, deferTimes: 5, installCommand: 'evil.exe', verifyInstall: false };
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
const render = (props: Record<string, unknown> = {}) => act(async () => root.render(createElement(PackageConfig, {
  package: pkg, installers: [installer], versions: ['1.0'], onClose: vi.fn(), ...props,
} as never)));

beforeEach(() => {
  settingsState.accountScope = 0;
  settingsState.packageDefaultsStatus = 'loaded';
  settingsState.packageDefaults = null;
  settingsState.save.mockClear();
  useCartStore.setState({ items: [] });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
});

describe('saved package defaults', () => {
  it.each(['loading', 'error'])('blocks saving and clearing unseen defaults while %s', async (status) => {
    settingsState.packageDefaultsStatus = status;
    settingsState.packageDefaults = { deployMode: 'Auto' };
    await render();
    await act(async () => button('Advanced').click());
    expect(button('Save as my defaults').disabled).toBe(true);
    await act(async () => button('Save as my defaults').click());
    expect(button('Clear saved defaults').disabled).toBe(true);
    await act(async () => button('Clear saved defaults').click());
    expect(settingsState.save).not.toHaveBeenCalled();
  });
  it('blocks adding until defaults load and then commits the seeded values', async () => {
    settingsState.packageDefaultsStatus = 'loading';
    await render();
    expect(button('Add to Selection').disabled).toBe(true);
    await act(async () => button('Add to Selection').click());
    expect(useCartStore.getState().items).toHaveLength(0);
    settingsState.packageDefaultsStatus = 'loaded';
    settingsState.packageDefaults = defaults;
    await render();
    expect(button('Add to Selection').disabled).toBe(false);
    await act(async () => button('Add to Selection').click());
    expect((useCartStore.getState().items[0] as Win32CartItem).psadtConfig.deployMode).toBe('NonInteractive');
  });

  it('allows standard settings after a failed defaults load', async () => {
    settingsState.packageDefaultsStatus = 'error';
    await render();
    expect(button('Add to Selection').disabled).toBe(false);
    await act(async () => button('Add to Selection').click());
    expect((useCartStore.getState().items[0] as Win32CartItem).psadtConfig.deployMode).toBe(DEFAULT_PSADT_CONFIG.deployMode);
  });

  it('does not gate Store apps or replacement cart items on defaults loading', async () => {
    settingsState.packageDefaultsStatus = 'loading';
    await render({ package: { ...pkg, appSource: 'store' } });
    expect(button('Add to Selection').disabled).toBe(false);
    useCartStore.setState({ items: [structuredClone(oldItem)] });
    await render({ deployedConfig: oldItem, replaceCartItemId: oldItem.id });
    expect(button('Update Selection').disabled).toBe(false);
  });
  it('keeps today\'s behavior without saved defaults', async () => {
    await render();
    await act(async () => button('Add to Selection').click());
    const item = useCartStore.getState().items[0] as Win32CartItem;
    expect(item.psadtConfig).toMatchObject({ deployMode: DEFAULT_PSADT_CONFIG.deployMode, allowDefer: DEFAULT_PSADT_CONFIG.allowDefer });
  });

  it('seeds a newly configured Win32 package with only the allowlisted defaults', async () => {
    settingsState.packageDefaults = defaults;
    await render();
    await act(async () => button('Add to Selection').click());
    const item = useCartStore.getState().items[0] as Win32CartItem;
    expect(item.psadtConfig).toMatchObject({ deployMode: 'NonInteractive', allowDefer: true, deferTimes: 5 });
    expect(item.psadtConfig.verifyInstall).toBe(DEFAULT_PSADT_CONFIG.verifyInstall);
    expect(item.installCommand).not.toContain('evil');
  });

  it('applies defaults that arrive after mount only while the config is untouched', async () => {
    await render();
    settingsState.packageDefaults = defaults;
    await render();
    await act(async () => button('Add to Selection').click());
    expect((useCartStore.getState().items[0] as Win32CartItem).psadtConfig.deployMode).toBe('NonInteractive');
  });

  it('ignores defaults for deployed configs and replaced cart items', async () => {
    settingsState.packageDefaults = defaults;
    useCartStore.setState({ items: [structuredClone(oldItem)] });
    await render({ deployedConfig: oldItem, replaceCartItemId: oldItem.id });
    await act(async () => button('Update Selection').click());
    expect((useCartStore.getState().items[0] as Win32CartItem).psadtConfig).toMatchObject({ deployMode: 'Silent', allowDefer: false });
  });

  it('saves the current allowed settings as defaults', async () => {
    await render();
    await act(async () => button('Advanced').click());
    await act(async () => button('Save as my defaults').click());
    expect(settingsState.save).toHaveBeenCalledOnce();
    const saved = settingsState.save.mock.calls[0][0] as Record<string, unknown>;
    expect(saved).toMatchObject({ deployMode: DEFAULT_PSADT_CONFIG.deployMode });
    for (const key of ['installCommand', 'detectionRules', 'processesToClose', 'verifyInstall', 'brandingCompanyName']) {
      expect(saved).not.toHaveProperty(key);
    }
  });

  it('leaves Store apps without PSADT defaults or default save controls', async () => {
    settingsState.packageDefaults = defaults;
    await render({ package: { ...pkg, appSource: 'store' } });
    expect(Array.from(document.querySelectorAll('button')).some((element) => element.textContent?.includes('Save as my defaults'))).toBe(false);
    await act(async () => button('Add to Selection').click());
    expect(useCartStore.getState().items[0]).toMatchObject({ appSource: 'store' });
    expect(useCartStore.getState().items[0]).not.toHaveProperty('psadtConfig');
  });

  it('does not seed defaults for a deployed app without a saved config', async () => {
    settingsState.packageDefaults = { deployMode: 'Auto' };
    await render({ isDeployed: true, deployedConfig: null });
    await act(async () => button('Advanced').click());
    await act(async () => button('Save as my defaults').click());
    expect(settingsState.save.mock.calls[0][0]).toMatchObject({ deployMode: DEFAULT_PSADT_CONFIG.deployMode });
  });

  it('discards seeded panel values when the account changes', async () => {
    settingsState.packageDefaults = { deployMode: 'Auto' };
    await render();
    settingsState.accountScope += 1;
    settingsState.packageDefaults = { deployMode: 'NonInteractive' };
    await render();
    await act(async () => button('Add to Selection').click());
    expect((useCartStore.getState().items[0] as Win32CartItem).psadtConfig.deployMode).toBe('NonInteractive');
  });

  it('does not apply late defaults after the user changes install behavior', async () => {
    await render();
    const advanced = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Advanced');
    await act(async () => advanced?.click());
    const behavior = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Installation Behavior'));
    await act(async () => behavior?.click());
    const select = Array.from(document.querySelectorAll('select')).find((element) => Array.from(element.options).some((option) => option.value === 'NonInteractive'));
    expect(select).toBeDefined();
    await act(async () => { select!.value = 'NonInteractive'; select!.dispatchEvent(new Event('change', { bubbles: true })); });
    settingsState.packageDefaults = { deployMode: 'Auto', allowDefer: true };
    await render();
    await act(async () => button('Add to Selection').click());
    expect((useCartStore.getState().items[0] as Win32CartItem).psadtConfig.deployMode).toBe('NonInteractive');
    expect((useCartStore.getState().items[0] as Win32CartItem).psadtConfig.allowDefer).toBe(DEFAULT_PSADT_CONFIG.allowDefer);
  });
});
