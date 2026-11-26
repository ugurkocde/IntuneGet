// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { Win32CartItem } from '@/types/upload';
import type { AppRelationship } from '@/types/intune';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});

const manifestState = vi.hoisted(() => ({ data: undefined, isFetching: false, error: null as Error | null }));
const updateSettingsMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-packages', () => ({
  useLocaleVariants: () => ({ data: { variants: [] }, isSuccess: true }),
  usePackageManifest: () => manifestState,
}));
vi.mock('@/components/providers/UserSettingsProvider', () => ({ useUserSettings: () => ({ settings: { carryOverAssignments: false } }) }));
vi.mock('@/hooks/use-update-app-settings', () => ({ useUpdateAppSettings: () => ({ isUpdating: false, updateSettings: updateSettingsMock }) }));
vi.mock('@/components/AppIcon', () => ({ AppIcon: () => null }));
vi.mock('@/components/AssignmentConfig', () => ({ AssignmentConfig: () => null }));
vi.mock('@/components/CategoryConfig', () => ({ CategoryConfig: () => null }));
vi.mock('@/components/DependencyConfig', () => ({ DependencyConfig: ({ relationships, onChange }: { relationships: AppRelationship[]; onChange: (value: AppRelationship[]) => void }) =>
  createElement('button', { onClick: () => onChange([...relationships, { relationshipType: 'dependency', targetId: '22222222-2222-4222-8222-222222222222', targetDisplayName: 'Added', dependencyType: 'autoInstall' }]) }, 'Add test relationship') }));
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
  updateSettingsMock.mockReset().mockResolvedValue(undefined);
  manifestState.error = null;
  useCartStore.setState({ items: [structuredClone(oldItem)] });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

it.each([false, true])('keeps the relationship baseline captured when the editor opens (edited=%s)', async (edited) => {
  const initial: AppRelationship = { relationshipType: 'dependency', targetId: '11111111-1111-4111-8111-111111111111', targetDisplayName: 'Initial', dependencyType: 'autoInstall' };
  const concurrent: AppRelationship = { ...initial, targetId: '33333333-3333-4333-8333-333333333333', targetDisplayName: 'Concurrent' };
  const props = { package: { id: oldItem.wingetId, name: oldItem.displayName, publisher: oldItem.publisher, version: '1.0' }, installers: [installer],
    isDeployed: true, intuneAppId: '44444444-4444-4444-8444-444444444444', deployedConfig: { ...oldItem, relationships: [initial] }, onClose: vi.fn() };
  await act(async () => root.render(createElement(PackageConfig, props)));
  const button = (text: string) => [...document.querySelectorAll('button')].find(x => x.textContent?.includes(text))!;
  if (edited) {
    await act(async () => button('Dependencies & Supersedence').click());
    await act(async () => button('Add test relationship').click());
  }
  // A normal background refetch changes the prop without remounting the editor.
  await act(async () => root.render(createElement(PackageConfig, { ...props, deployedConfig: { ...oldItem, relationships: [initial, concurrent] } })));
  const save = button('Update Settings');
  if (!edited) {
    expect(save.disabled).toBe(true);
    expect(updateSettingsMock).not.toHaveBeenCalled();
    return;
  }
  expect(save.disabled).toBe(false);
  updateSettingsMock.mockRejectedValue(new Error('Relationships changed; refresh before saving.'));
  await act(async () => save.click());
  expect(updateSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
    baselineRelationships: [initial],
    relationships: [initial, expect.objectContaining({ targetDisplayName: 'Added' })],
  }));
  expect(document.body.textContent).toContain('Relationships changed; refresh before saving.');
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
});

describe('reviewing a replacement version', () => {
  it('keeps the live version spelling through configuration, cart saving, and detection', async () => {
    useCartStore.setState({ items: [] });
    await act(async () => root.render(createElement(PackageConfig, {
      package: { id: oldItem.wingetId, name: oldItem.displayName, publisher: oldItem.publisher, version: '3.0' },
      installers: [installer], versions: ['v3.0'],
      deployedConfig: { ...oldItem, version: '3.0' }, onClose: vi.fn(),
    })));
    const add = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Add to Selection'))!;
    expect(add.disabled).toBe(false);
    await act(async () => add.click());
    expect(useCartStore.getState().items[0]).toMatchObject({ version: 'v3.0', installerUrl: installer.url });
    expect((useCartStore.getState().items[0] as Win32CartItem).detectionRules).toEqual(
      expect.arrayContaining([expect.objectContaining({ detectionValue: 'v3.0' })]),
    );
  });

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

it('places a saved configuration refresh notice inside the editor focus boundary', async () => {
  const retry = vi.fn();
  const props = { package: { id: oldItem.wingetId, name: oldItem.displayName, publisher: oldItem.publisher, version: '1.0' }, installers: [installer], deployedConfig: oldItem, onClose: vi.fn(),
    configurationRefreshNotice: createElement('div', { role: 'alert' }, createElement('button', { onClick: retry }, 'Retry saved configuration')) };
  await act(async () => root.render(createElement(PackageConfig, props)));
  const button = [...document.querySelectorAll('button')].find(x => x.textContent === 'Retry saved configuration')!;
  expect(button).toBeDefined();
  const focusBoundary = document.querySelector('[role="dialog"]')!.children[1];
  expect(focusBoundary.contains(button)).toBe(true);
  const before = useCartStore.getState().items;
  await act(async () => button.click()); expect(retry).toHaveBeenCalledTimes(1);
  expect(useCartStore.getState().items).toBe(before);
});


it('keeps copy assignments non-destructive when adding an automatic update policy', async () => {
  useCartStore.setState({ items: [] });
  await act(async () => root.render(createElement(PackageConfig, {
    package: { id: oldItem.wingetId, name: oldItem.displayName, publisher: oldItem.publisher, version: '3.0' },
    installers: [installer], versions: ['3.0'],
    deployedConfig: { ...oldItem, version: '3.0', updatePolicy: 'auto_update',
      assignmentMigration: { carryOverAssignments: true, removeAssignmentsFromPreviousApp: false } },
    onClose: vi.fn(),
  })));
  const add = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Add to Selection'))!;
  expect(add.disabled).toBe(false);
  await act(async () => add.click());
  expect(useCartStore.getState().items[0]).toMatchObject({
    updatePolicy: 'auto_update',
    assignmentMigration: { carryOverAssignments: true, removeAssignmentsFromPreviousApp: false },
  });
});

describe('same app content selection', () => {
  it.each([false, true])('keeps create as default and supports explicit replacement: %s', async update => {
    useCartStore.setState({ items: [] });
    await act(async () => root.render(createElement(PackageConfig, { package: { id: oldItem.wingetId, name: oldItem.displayName, publisher: oldItem.publisher, version: '2.0' }, installers: [installer], isDeployed: true, intuneAppId: '44444444-4444-4444-8444-444444444444', deployedConfig: { ...oldItem, version: '2.0' }, onClose: vi.fn() })));
    const radio = document.querySelector<HTMLInputElement>('input[value="sameApp"]');
    expect(radio).not.toBeNull();
    if (update) await act(async () => radio!.click());
    if (update) expect(document.body.textContent).toContain('Changes made to those fields directly in Intune will be overwritten.');
    const add = [...document.querySelectorAll('button')].find(x => /Redeploy|Add to Selection|Update Content/.test(x.textContent || ''))!;
    await act(async () => add.click());
    const item = useCartStore.getState().items[0];
    if (update) {
      expect(item).toMatchObject({ updateMode: 'sameApp', targetIntuneAppId: '44444444-4444-4444-8444-444444444444' });
      for (const key of ['forceCreate','assignments','categories','espProfiles','relationships','assignmentMigration']) expect((item as unknown as Record<string, unknown>)[key]).toBeUndefined();
    } else { expect(item).toMatchObject({ forceCreate: true }); expect(item).not.toHaveProperty('updateMode'); }
  });
});

it('retains an existing same app target while recovering its selected installer', async () => {
  const saved: Win32CartItem = { ...oldItem, forceCreate: undefined, updateMode: 'sameApp', targetIntuneAppId: '44444444-4444-4444-8444-444444444444', categories: undefined };
  useCartStore.setState({ items: [saved] });
  await act(async () => root.render(createElement(PackageConfig, { package: { id: saved.wingetId, name: saved.displayName, publisher: saved.publisher, version: '2.0' }, installers: [installer], deployedConfig: { ...saved, version: '2.0' }, replaceCartItemId: saved.id, onClose: vi.fn() })));
  expect(document.querySelector<HTMLInputElement>('input[value="create"]')!.disabled).toBe(true);
  const add = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('Update Content'))!;
  await act(async () => add.click());
  expect(useCartStore.getState().items[0]).toMatchObject({ updateMode: 'sameApp', targetIntuneAppId: saved.targetIntuneAppId, version: '2.0' });
  expect((useCartStore.getState().items[0] as Win32CartItem).forceCreate).toBeUndefined();
});
