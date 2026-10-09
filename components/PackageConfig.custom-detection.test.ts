// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { Win32CartItem } from '@/types/upload';
import type { DetectionRule } from '@/types/intune';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});

const manifestState = vi.hoisted(() => ({
  data: undefined as unknown,
  isFetching: false,
  error: null as Error | null,
}));
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

const TOGGLE_LABEL = 'Use my own detection rules';
const MARKER_PLACEHOLDER = 'SOFTWARE\\IntuneGet\\Apps';
const installer = { architecture: 'x64' as const, type: 'msi' as const, url: 'https://example.test/app.msi', sha256: 'B'.repeat(64), scope: 'machine' as const };
const pkg = { id: 'Example.App', name: 'Example App', publisher: 'Example', version: '2.0' };

const deployed: Win32CartItem = {
  id: 'deployed-id', addedAt: '2026-10-09', appSource: 'win32', wingetId: 'Example.App',
  displayName: 'Example App', publisher: 'Example', version: '2.0', architecture: 'x64', installScope: 'machine',
  installerType: 'msi', installerUrl: installer.url, installerSha256: installer.sha256,
  installCommand: 'custom install', uninstallCommand: 'custom uninstall', detectionRules: [],
  psadtConfig: {
    ...DEFAULT_PSADT_CONFIG, processesToClose: [],
    installCommand: 'custom install', uninstallCommand: 'custom uninstall',
  },
};

async function render(props: Record<string, unknown> = {}) {
  await act(async () => root.render(createElement(PackageConfig, {
    package: pkg, installers: [installer], versions: ['2.0', '1.0'], onClose: vi.fn(), ...props,
  } as Parameters<typeof PackageConfig>[0])));
}

function buttonWithText(text: string) {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
}

function customToggle() {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((s) => {
    const labelId = s.getAttribute('aria-labelledby');
    return labelId && document.getElementById(labelId)?.textContent === TOGGLE_LABEL;
  });
}

function field<T extends HTMLElement = HTMLInputElement>(labelText: string): T {
  const label = [...document.querySelectorAll('label')].find((l) => l.textContent?.trim() === labelText);
  if (!label) throw new Error(`No field labelled ${labelText}`);
  return document.getElementById(label.htmlFor) as T;
}

async function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const isSelect = el instanceof HTMLSelectElement;
  const proto = isSelect ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(isSelect ? 'change' : 'input', { bubbles: true }));
  });
}

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('Element not found');
  await act(async () => el.click());
}

async function selectVersion(version: string) {
  manifestState.data = { manifest: { version }, installers: [installer] };
  await click(buttonWithText('v2.0'));
  await click(buttonWithText(`v${version}`));
}

async function save() {
  await click(buttonWithText('Add to Selection'));
  return useCartStore.getState().items[0] as Win32CartItem | undefined;
}

function generatedMarker(version: string, root = 'SOFTWARE\\IntuneGet\\Apps') {
  return {
    type: 'registry',
    keyPath: `HKEY_LOCAL_MACHINE\\${root}\\Example_App`,
    valueName: 'Version',
    detectionValue: version,
  };
}

beforeEach(() => {
  manifestState.data = undefined;
  manifestState.error = null;
  useCartStore.setState({ items: [] });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
});

describe('custom detection rules', () => {
  it('keeps the generated marker by default and does not add the flag', async () => {
    await render();
    expect(customToggle()?.getAttribute('aria-checked')).toBe('false');
    await selectVersion('1.0');
    const item = await save();
    expect(item?.detectionRules).toEqual([expect.objectContaining(generatedMarker('1.0'))]);
    expect(item?.psadtConfig).not.toHaveProperty('customDetection');
  });

  it('offers only registry, file and MSI rule types', async () => {
    await render();
    await click(customToggle());
    const types = [...field<HTMLSelectElement>('Rule 1 type').options].map((o) => o.value);
    expect(types).toEqual(['registry', 'file', 'msi']);
  });

  it('keeps edited rules fixed across version and marker changes and saves them to the cart', async () => {
    await render({ deployedConfig: deployed });
    await click(customToggle());
    expect(customToggle()?.getAttribute('aria-checked')).toBe('true');

    await setValue(field('Rule 1 key path'), 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Example');
    await setValue(field('Rule 1 value name (optional)'), 'DisplayVersion');
    await setValue(field<HTMLSelectElement>('Rule 1 detection method'), 'version');
    await setValue(field('Rule 1 expected value'), '2.0');

    const marker = document.querySelector<HTMLInputElement>(`input[placeholder="${MARKER_PLACEHOLDER.replace(/\\/g, '\\\\')}"]`)!;
    await setValue(marker, 'SOFTWARE\\Contoso\\Apps');
    await selectVersion('1.0');

    const item = await save();
    const expected: DetectionRule[] = [{
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Example',
      valueName: 'DisplayVersion',
      detectionType: 'version',
      operator: 'greaterThanOrEqual',
      detectionValue: '2.0',
      check32BitOn64System: false,
    }];
    expect(item?.version).toBe('1.0');
    expect(item?.detectionRules).toEqual(expected);
    expect(item?.psadtConfig.detectionRules).toEqual(expected);
    expect(item?.psadtConfig).toMatchObject({ customDetection: true, registryMarkerPath: 'SOFTWARE\\Contoso\\Apps' });
    expect(item).toMatchObject({ installCommand: 'custom install', uninstallCommand: 'custom uninstall' });
  });

  it('saves file and MSI rules as entered', async () => {
    await render();
    await click(customToggle());
    await setValue(field<HTMLSelectElement>('Rule 1 type'), 'file');
    await setValue(field('Rule 1 folder path'), 'C:\\Program Files\\Example');
    await setValue(field('Rule 1 file or folder name'), 'example.exe');
    await click(buttonWithText('Add detection rule'));
    await setValue(field<HTMLSelectElement>('Rule 2 type'), 'msi');
    await setValue(field('Rule 2 product code'), '{11111111-2222-3333-4444-555555555555}');

    const item = await save();
    expect(item?.detectionRules).toEqual([
      { type: 'file', path: 'C:\\Program Files\\Example', fileOrFolderName: 'example.exe', detectionType: 'exists', check32BitOn64System: false },
      { type: 'msi', productCode: '{11111111-2222-3333-4444-555555555555}' },
    ]);
    expect(item?.psadtConfig.customDetection).toBe(true);
  });

  it('blocks saving incomplete rules and shows why', async () => {
    await render();
    await click(customToggle());
    await save();
    expect(useCartStore.getState().items).toEqual([]);
    expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });

  it('restores generated rules when switched off and remembers the edits when switched on again', async () => {
    await render();
    await click(customToggle());
    await setValue(field('Rule 1 key path'), 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Example');
    await click(customToggle());
    expect(customToggle()?.getAttribute('aria-checked')).toBe('false');
    expect(document.body.textContent).toContain('HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Example_App');

    await click(customToggle());
    expect(field('Rule 1 key path').value).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Example');
    await click(customToggle());

    const item = await save();
    expect(item?.detectionRules).toEqual([expect.objectContaining(generatedMarker('2.0'))]);
    expect(item?.psadtConfig).not.toHaveProperty('customDetection');
  });

  it('keeps saved custom rules when a deployed configuration is reopened', async () => {
    const rules: DetectionRule[] = [{ type: 'msi', productCode: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}' }];
    await render({
      deployedConfig: { ...deployed, detectionRules: rules, psadtConfig: { ...deployed.psadtConfig, customDetection: true, detectionRules: rules } },
    });
    expect(customToggle()?.getAttribute('aria-checked')).toBe('true');
    expect(field('Rule 1 product code').value).toBe('{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}');
    const item = await save();
    expect(item?.detectionRules).toEqual(rules);
    expect(item?.psadtConfig.customDetection).toBe(true);
  });

  it('remembers authored rules after switching through an unsupported installer', async () => {
    await render();
    await click(customToggle());
    const keyPath = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Example';
    await setValue(field('Rule 1 key path'), keyPath);
    await render({ installers: [{ ...installer, type: 'msix' }] });
    expect(customToggle()).toBeUndefined();
    await render();
    expect(customToggle()?.getAttribute('aria-checked')).toBe('false');
    await click(customToggle());
    expect(field('Rule 1 key path').value).toBe(keyPath);
    const item = await save();
    expect(item?.psadtConfig.customDetection).toBe(true);
    expect(item?.detectionRules).toEqual([{ type: 'registry', keyPath, detectionType: 'exists', check32BitOn64System: false }]);
    expect(item?.psadtConfig.detectionRules).toEqual(item?.detectionRules);
  });

  it.each([
    ['MSIX', { installers: [{ ...installer, type: 'msix' }] }],
    ['APPX', { installers: [{ ...installer, type: 'appx' }] }],
    ['nested MSIX', { installers: [{ ...installer, type: 'zip', nestedInstallerType: 'msix' }] }],
    ['nested APPX', { installers: [{ ...installer, type: 'zip', nestedInstallerType: 'appx' }] }],
    ['curated', { package: { ...pkg, id: 'IntuneGet.Curated.Example' } }],
    ['curated source', { deployedConfig: { ...deployed, sourceType: 'curated' } }],
    ['custom source', { deployedConfig: { ...deployed, sourceType: 'custom' } }],
  ])('hides the option for %s packages and ignores a stored flag', async (_name, props) => {
    const base = (props as { deployedConfig?: Win32CartItem }).deployedConfig ?? deployed;
    const forged: DetectionRule[] = [{ type: 'msi', productCode: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}' }];
    await render({
      ...props,
      deployedConfig: { ...base, psadtConfig: { ...base.psadtConfig, customDetection: true, detectionRules: forged } },
    });
    expect(document.body.textContent).toContain('Detection Rules');
    expect(customToggle()).toBeUndefined();
    expect(document.body.textContent).not.toContain('Rule 1 type');
    const item = await save();
    expect(item?.psadtConfig).not.toHaveProperty('customDetection');
    expect(item?.detectionRules).not.toEqual(forged);
  });

  it('does not show detection rules for Microsoft Store apps', async () => {
    await render({ package: { ...pkg, appSource: 'store', packageIdentifier: '9NBLGGH4NNS1' }, installers: [] });
    expect(document.body.textContent).not.toContain('Detection Rules');
    expect(customToggle()).toBeUndefined();
  });
});
