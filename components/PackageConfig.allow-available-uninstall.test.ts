// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { Win32CartItem } from '@/types/upload';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
});

const updateSettingsMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('@/hooks/use-packages', () => ({
  useLocaleVariants: () => ({ data: { variants: [] }, isSuccess: true }),
  usePackageManifest: () => ({ data: undefined, isFetching: false, error: null }),
}));
vi.mock('@/components/providers/UserSettingsProvider', () => ({
  useUserSettings: () => ({
    settings: { carryOverAssignments: false },
    packageDefaults: null,
    packageDefaultsStatus: 'loaded',
    packageDefaultsAccountScope: 0,
    savePackageDefaults: vi.fn(async () => undefined),
  }),
}));
vi.mock('@/hooks/use-update-app-settings', () => ({
  useUpdateAppSettings: () => ({ updateSettings: updateSettingsMock, isUpdating: false }),
}));
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
const installer = { architecture: 'x64' as const, type: 'msi' as const, url: 'https://example.test/app.msi', sha256: 'B'.repeat(64), scope: 'machine' as const };
const pkg = { id: 'Contoso.App', name: 'Contoso App', publisher: 'Contoso', version: '1.0' };
const deployedWin32: Win32CartItem = {
  id: 'deployed-1',
  addedAt: '2026-11-27T00:00:00Z',
  appSource: 'win32',
  wingetId: 'Contoso.App',
  displayName: 'Contoso App',
  publisher: 'Contoso',
  version: '1.0',
  architecture: 'x64',
  installScope: 'machine',
  installerType: 'msi',
  installerUrl: 'https://example.test/app.msi',
  installerSha256: 'B'.repeat(64),
  installCommand: 'msiexec /i app.msi /qn',
  uninstallCommand: 'msiexec /x {1111} /qn',
  detectionRules: [],
  psadtConfig: { ...DEFAULT_PSADT_CONFIG, deployMode: 'Silent', allowDefer: false, processesToClose: [] },
};

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
const switchByLabel = (labelText: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button[role="switch"]')].find((sw) => {
    const labelId = sw.getAttribute('aria-labelledby');
    return labelId ? document.getElementById(labelId)?.textContent?.includes(labelText) : false;
  });

const render = (props: Record<string, unknown> = {}) =>
  act(async () => root.render(createElement(PackageConfig, {
    package: pkg,
    installers: [installer],
    versions: ['1.0'],
    onClose: vi.fn(),
    ...props,
  } as never)));

beforeEach(() => {
  updateSettingsMock.mockClear();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_HOSTED_ALLOW_AVAILABLE_UNINSTALL;
  useCartStore.setState({ items: [] });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
});

describe('PackageConfig Allow available uninstall toggle', () => {
  it('shows toggle for deployed Win32 app, classifies change as Graph-only, and sends allowAvailableUninstall via Update Settings', async () => {
    await render({
      isDeployed: true,
      intuneAppId: '11111111-1111-4111-8111-111111111111',
      deployedConfig: deployedWin32,
    });

    const assignmentBtn = button('Assignment Configuration');
    expect(assignmentBtn).toBeTruthy();
    await act(async () => assignmentBtn!.click());

    const sw = switchByLabel('Allow available uninstall');
    expect(sw).toBeTruthy();
    expect(sw!.getAttribute('aria-checked')).toBe('false');

    await act(async () => { sw!.click(); });
    expect(sw!.getAttribute('aria-checked')).toBe('true');

    const updateBtn = button('Update Settings');
    expect(updateBtn).toBeTruthy();
    expect(updateBtn!.disabled).toBe(false);
    await act(async () => updateBtn!.click());

    expect(updateSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      intuneAppId: '11111111-1111-4111-8111-111111111111',
      wingetId: 'Contoso.App',
      allowAvailableUninstall: true,
    }));
  });

  it('pre-fills true from deployedConfig and sends explicit false when turned off', async () => {
    await render({
      isDeployed: true,
      intuneAppId: '11111111-1111-4111-8111-111111111111',
      deployedConfig: { ...deployedWin32, allowAvailableUninstall: true },
    });

    await act(async () => button('Assignment Configuration')!.click());
    const sw = switchByLabel('Allow available uninstall');
    expect(sw!.getAttribute('aria-checked')).toBe('true');

    await act(async () => { sw!.click(); });
    expect(sw!.getAttribute('aria-checked')).toBe('false');
    await act(async () => button('Update Settings')!.click());

    expect(updateSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      allowAvailableUninstall: false,
    }));
  });

  it('keeps allowAvailableUninstall undefined on fresh package when untouched', async () => {
    await render();
    await act(async () => button('Add to Selection')!.click());
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect((items[0] as Win32CartItem).allowAvailableUninstall).toBeUndefined();
  });

  it('hides toggle for Store apps and sameApp content updates', async () => {
    await render({ package: { ...pkg, source: 'msstore' } });
    expect(switchByLabel('Allow available uninstall')).toBeUndefined();

    await render({
      isDeployed: true,
      intuneAppId: '11111111-1111-4111-8111-111111111111',
      deployedConfig: deployedWin32,
    });
    const sameAppRadio = document.querySelector<HTMLInputElement>('input[name="content-update-mode"][value="sameApp"]');
    expect(sameAppRadio).toBeTruthy();
    await act(async () => { sameAppRadio!.click(); });
    expect(switchByLabel('Allow available uninstall')).toBeUndefined();
  });

  it('omits allowAvailableUninstall from cart item on hosted Phase 1 Redeploy so POST /api/package never 400s', async () => {
    const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevHostedFlag = process.env.NEXT_PUBLIC_HOSTED_ALLOW_AVAILABLE_UNINSTALL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://hosted.supabase.co';
    delete process.env.NEXT_PUBLIC_HOSTED_ALLOW_AVAILABLE_UNINSTALL;
    try {
      await render({
        isDeployed: true,
        intuneAppId: '11111111-1111-4111-8111-111111111111',
        deployedConfig: { ...deployedWin32, allowAvailableUninstall: true },
      });

      // Toggle remains available for Graph-only Update Settings
      await act(async () => button('Assignment Configuration')!.click());
      expect(switchByLabel('Allow available uninstall')?.getAttribute('aria-checked')).toBe('true');

      // Trigger a Redeploy (Add to Selection (Redeploy)) and verify allowAvailableUninstall is omitted
      const redeployBtn = button('Redeploy') ?? button('Add to Selection (Redeploy)');
      expect(redeployBtn).toBeTruthy();
      await act(async () => redeployBtn!.click());

      const items = useCartStore.getState().items;
      expect(items).toHaveLength(1);
      expect((items[0] as Win32CartItem).allowAvailableUninstall).toBeUndefined();
    } finally {
      if (prevSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
      if (prevHostedFlag === undefined) delete process.env.NEXT_PUBLIC_HOSTED_ALLOW_AVAILABLE_UNINSTALL;
      else process.env.NEXT_PUBLIC_HOSTED_ALLOW_AVAILABLE_UNINSTALL = prevHostedFlag;
    }
  });
});
