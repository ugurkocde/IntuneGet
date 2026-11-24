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

import { isQaRunnerArchitectureSupported } from '@/lib/qa/candidate';
import { PackageConfig, HOSTED_QA_ARCHITECTURES } from './PackageConfig';
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
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-test-key');
  manifestState.data = undefined;
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


const arm = { ...installer, architecture: 'arm64' as const };
const reason = 'ARM64 builds cannot be deployed yet';
describe('hosted architecture selection', () => {
  it.each([false, true])('preserves source-classified curated access without an ID prefix, deployed=%s', async (isDeployed) => {
    await render({ installers: [arm], isDeployed, deployedConfig: { ...oldItem, architecture: 'arm64', sourceType: 'curated' }, intuneAppId: isDeployed ? 'fixture-app' : undefined });
    expect(button('arm64').disabled).toBe(false);
    expect(button(isDeployed ? 'Redeploy' : 'Add to Selection').disabled).toBe(false);
    expect(document.body.textContent).not.toContain(reason);
  });
  it.each(['neutral', 'arm'] as const)('explains a blocked %s installer', async (architecture) => {
    await render({ installers: [{ ...installer, architecture }] });
    expect(button('Add to Selection').disabled).toBe(true);
    expect(document.body.textContent).toContain(`${architecture} builds cannot be deployed yet`);
    await act(async () => button('Add to Selection').click());
    expect(useCartStore.getState().items).toHaveLength(0);
  });
  it('blocks an ARM64 only catalog package before it enters the cart', async () => {
    await render({ installers: [arm] });
    expect(button('Add to Selection').disabled).toBe(true);
    expect(document.body.textContent).toContain(reason);
    expect(button('arm64').disabled).toBe(true);
    await act(async () => button('Add to Selection').click());
    expect(useCartStore.getState().items).toHaveLength(0);
  });
  it('prefers x64 when ARM64 is first in upstream metadata', async () => {
    await render({ installers: [arm, installer] });
    expect(button('x64').className).toContain('bg-accent-cyan');
    expect(button('arm64').disabled).toBe(true);
    await act(async () => button('Add to Selection').click());
    expect(useCartStore.getState().items[0]).toMatchObject({ architecture: 'x64' });
  });
  it('keeps an existing ARM64 selection visible and blocks redeployment', async () => {
    await render({ installers: [arm, installer], isDeployed: true, deployedConfig: { ...oldItem, architecture: 'arm64' }, intuneAppId: 'fixture-app' });
    expect(button('arm64').className).toContain('bg-accent-cyan');
    expect(button('Redeploy').disabled).toBe(true);
    expect(document.body.textContent).toContain(reason);
  });
  it('does not silently choose ARM64 after a version changes', async () => {
    await render({ versions: ['1.0', '2.0'] });
    await act(async () => button('v1.0').click());
    await act(async () => button('v2.0').click());
    manifestState.data = { manifest: { version: '2.0' }, installers: [arm, { ...installer, architecture: 'x86' }] } as never;
    await render({ versions: ['1.0', '2.0'] });
    expect(button('x86').className).toContain('bg-accent-cyan');
    expect(button('arm64').disabled).toBe(true);
  });
  it('retains ARM64 support without hosted services', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    await render({ installers: [arm] });
    expect(button('Add to Selection').disabled).toBe(false);
    expect(button('arm64').disabled).toBe(false);
  });
  it.each(['custom', 'curated'])('preserves the %s server exemption', async (source) => {
    await render({ installers: [arm], package: { ...pkg, id: source === 'curated' ? 'IntuneGet.Curated.Fixture' : pkg.id }, deployedConfig: source === 'custom' ? { ...oldItem, architecture: 'arm64', sourceType: 'custom' } : null });
    expect(button('Add to Selection').disabled).toBe(false);
    expect(button('arm64').disabled).toBe(false);
  });
});


it('keeps the display gate aligned with the existing hosted runner contract', () => {
  for (const arch of ['x64', 'x86', 'arm64', 'ARM64']) {
    expect(HOSTED_QA_ARCHITECTURES.has(arch.toLowerCase())).toBe(isQaRunnerArchitectureSupported(arch));
  }
});
