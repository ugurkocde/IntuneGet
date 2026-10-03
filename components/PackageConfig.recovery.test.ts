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
vi.mock('@/components/providers/UserSettingsProvider', () => ({ useUserSettings: () => ({ settings: { carryOverAssignments: false } }) }));
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
const oldItem: Win32CartItem = {
  id: 'retained-cart-id', addedAt: '2026-07-09', appSource: 'win32', wingetId: 'Example.App',
  displayName: 'Example App', publisher: 'Example', version: '1.0', architecture: 'x64', installScope: 'machine',
  installerType: 'msi', installerUrl: 'https://example.test/old.msi', installerSha256: 'A'.repeat(64),
  installCommand: 'old command', uninstallCommand: 'old uninstall', detectionRules: [], forceCreate: true,
  psadtConfig: { ...DEFAULT_PSADT_CONFIG, allowDefer: true, deferTimes: 7, processesToClose: [] },
  categories: [{ id: 'category-id', displayName: 'Productivity' }],
};

beforeEach(() => {
  manifestState.error = null;
  useCartStore.setState({ items: [structuredClone(oldItem)] });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
});

describe('reviewing a replacement version', () => {
  it.each(['2.0', '1.0'])('reviews version %s before replacing its installer and preserving settings', async (version) => {
    const saved = vi.fn();
    await act(async () => root.render(createElement(PackageConfig, {
      package: { id: oldItem.wingetId, name: oldItem.displayName, publisher: oldItem.publisher, version },
      installers: [installer], versions: [version],
      deployedConfig: { ...oldItem, version }, replaceCartItemId: oldItem.id,
      onAddedToCart: saved, onClose: vi.fn(),
    })));
    expect(useCartStore.getState().items[0].version).toBe('1.0');
    const save = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Update Selection'))!;
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0]).toMatchObject({
      id: oldItem.id, version, installerUrl: installer.url, installerSha256: installer.sha256,
      forceCreate: true, categories: oldItem.categories,
      psadtConfig: { allowDefer: true, deferTimes: 7 },
    });
    expect((useCartStore.getState().items[0] as Win32CartItem).detectionRules).toEqual(
      expect.arrayContaining([expect.objectContaining({ detectionValue: version })]),
    );
    expect(saved).toHaveBeenCalledOnce();
  });

  it('does not use default-version installers after loading an older selection fails', async () => {
    manifestState.error = new Error('This version is no longer available.');
    useCartStore.setState({ items: [] });
    await act(async () => root.render(createElement(PackageConfig, {
      package: { id: oldItem.wingetId, name: oldItem.displayName, publisher: oldItem.publisher, version: '2.0' },
      installers: [installer], versions: ['2.0', '1.0'], deployedConfig: oldItem, onClose: vi.fn(),
    })));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('no longer available');
    const add = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Add to Selection'))!;
    expect(add.disabled).toBe(true);
    await act(async () => add.click());
    expect(useCartStore.getState().items).toEqual([]);
  });
});
