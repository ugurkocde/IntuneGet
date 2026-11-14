// @vitest-environment happy-dom
import { act, createElement, useState, type ReactNode, type InputEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NormalizedPackage } from '@/types/winget';
import type { useDeployedConfig } from '@/hooks/use-deployed-config';
const state = vi.hoisted(() => ({
  pkg: { id: 'Fixture.App', name: 'Fixture app', publisher: 'Fixture', version: '1.0' },
  params: new URLSearchParams(), deployed: true, config: {} as ReturnType<typeof useDeployedConfig>, editor: vi.fn(), retry: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => state.params }));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => createElement('span', null, children) }));
vi.mock('next/dynamic', () => ({ default: () => function Editor(props: { isDeployed: boolean; deployedConfig: unknown; onClose: () => void; configurationRefreshNotice?: ReactNode }) {
  const [draft, setDraft] = useState('');
  state.editor(props);
  return createElement('div', { 'data-config-editor': true },
    createElement('input', { 'data-draft': true, value: draft, onInput: (event: InputEvent<HTMLInputElement>) => setDraft(event.currentTarget.value) }),
    createElement('button', { onClick: props.onClose }, 'Close fixture editor'), props.configurationRefreshNotice);
} }));
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => children, Var: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/providers/UserSettingsProvider', () => ({ useUserSettings: () => ({ settings: { viewMode: 'grid' }, setViewMode: vi.fn() }) }));
vi.mock('@/hooks/use-near-viewport', () => ({ useNearViewport: () => ({ ref: { current: null }, near: false }) }));
vi.mock('@/hooks/use-deployed-packages', () => ({ useDeployedPackages: () => ({ deployedSet: new Set(state.deployed ? ['Fixture.App'] : []) }) }));
vi.mock('@/hooks/use-tenant-deployments', () => ({ useTenantDeployments: () => ({ tenantDeployments: new Map() }) }));
vi.mock('@/hooks/use-deployed-config', () => ({ useDeployedConfig: () => state.config }));
vi.mock('@/hooks/use-bulk-add', () => ({ useBulkAdd: () => ({ bulkAdd: vi.fn() }) }));
vi.mock('@/hooks/use-qa', () => ({ useQaStatuses: () => ({ data: { statuses: {} } }) }));
vi.mock('@/hooks/use-curated-releases', () => ({ useCuratedReleases: () => ({ data: null }) }));
vi.mock('@/hooks/use-packages', () => ({
  useCategories: () => ({ data: { categories: [] } }), usePopularPackages: () => ({}),
  useSearchPackages: () => ({}), useInfinitePackages: () => ({ data: { pages: [{ packages: [state.pkg] }] } }),
  useCatalogPackage: () => ({}), usePackageManifest: () => ({ data: { installers: [{}], versions: ['1.0'] } }), useStoreManifest: () => ({}),
  ManifestFetchError: class extends Error { suggestions = []; },
}));
vi.mock('@/components/FeaturedApps', () => ({ FeaturedApps: () => null }));
vi.mock('@/components/AppCollection', () => ({ AppCollection: () => null }));
vi.mock('@/components/AppSearch', () => ({ AppSearch: () => null }));
vi.mock('@/components/AppCard', () => ({ AppCard: ({ package: pkg, onSelect }: { package: NormalizedPackage; onSelect: (p: NormalizedPackage) => void }) => createElement('button', { onClick: () => onSelect(pkg) }, 'Edit fixture app') }));
vi.mock('@/components/AppListItem', () => ({ AppListItem: () => null }));
vi.mock('@/components/VirtualAppList', () => ({ APP_GRID_TEMPLATE_COLUMNS: '', VirtualAppList: ({ items, renderItem }: { items: NormalizedPackage[]; renderItem: (p: NormalizedPackage) => ReactNode }) => items.map(renderItem) }));
import AppCatalogPage from './page';
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  state.deployed = true; state.params = new URLSearchParams(); state.editor.mockClear(); state.retry.mockReset();
  state.config = { scopeKey: 'fixture-self', deployedConfig: null, deployedAt: null, intuneAppId: null, isLoading: false, isFetching: false, isPending: false, isError: true, error: new Error('private config failure'), refetch: state.retry };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(createElement(AppCatalogPage)));
const select = async () => { await render(); const b = [...host.querySelectorAll('button')].find(x => x.textContent === 'Edit fixture app')!; await act(async () => b.click()); };
const editor = () => host.querySelector('[data-config-editor]');
const alert = () => host.querySelector('[role="alert"]');
it('blocks default editing on a failed configuration read and shows Retry and Close', async () => {
  await select(); expect(editor()).toBeNull(); expect(alert()).not.toBeNull();
  expect(host.textContent).not.toContain('private config failure'); expect(host.textContent).toContain('Retry'); expect(host.textContent).toContain('Close');
});
it('also blocks editing after a failed refetch with a cached configuration', async () => {
  state.config.deployedConfig = { displayName: 'Cached fixture config' } as NonNullable<typeof state.config.deployedConfig>;
  await select(); expect(editor()).toBeNull(); expect(alert()).not.toBeNull();
});
it('keeps a pending disabled read in the loading dialog', async () => {
  Object.assign(state.config, { isPending: true, isError: false, error: null });
  await select(); expect(editor()).toBeNull(); expect(host.querySelector('[aria-label="Loading package details"]')).not.toBeNull(); expect(alert()).toBeNull();
});
it('retries once, disables the in-flight retry and opens only after success', async () => {
  await select(); expect(alert()).not.toBeNull(); const button = [...alert()!.querySelectorAll('button')].find(x => x.textContent === 'Retry')!;
  expect(button.type).toBe('button'); await act(async () => button.click()); expect(state.retry).toHaveBeenCalledTimes(1);
  state.config.isFetching = true; await render();
  const pendingButton = [...alert()!.querySelectorAll('button')].find(x => x.textContent === 'Retry')!; expect(pendingButton.disabled).toBe(true); expect(editor()).toBeNull();
  Object.assign(state.config, { isFetching: false, isError: false, error: null, deployedConfig: { displayName: 'Loaded fixture config' } }); await render();
  expect(editor()).not.toBeNull(); expect(state.editor.mock.calls.at(-1)![0].deployedConfig).toEqual({ displayName: 'Loaded fixture config' });
});
it('closes the error dialog without opening defaults', async () => {
  await select(); expect(alert()).not.toBeNull(); const close = [...alert()!.querySelectorAll('button')].find(x => x.textContent === 'Close')!; await act(async () => close.click());
  expect(alert()).toBeNull(); expect(editor()).toBeNull();
});
it('preserves successful null settings and does not block an app that is not deployed', async () => {
  Object.assign(state.config, { isError: false, error: null }); await select();
  expect(editor()).not.toBeNull(); expect(state.editor.mock.calls.at(-1)![0].deployedConfig).toBeNull();
  state.deployed = false; Object.assign(state.config, { isError: true, error: new Error('not queried') }); await render();
  expect(editor()).not.toBeNull(); expect(state.editor.mock.calls.at(-1)![0].isDeployed).toBe(false);
});

it('keeps the mounted editor draft after a background refresh fails', async () => {
  Object.assign(state.config, { isError: false, error: null, deployedConfig: { displayName: 'Saved fixture' } });
  await select();
  const input = host.querySelector<HTMLInputElement>('[data-draft]')!;
  await act(async () => { input.value = 'Unsaved fixture draft'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  Object.assign(state.config, { isError: true, error: new Error('private refresh error') });
  await render();
  expect(host.querySelector('[data-draft]')).toBe(input);
  expect(input.value).toBe('Unsaved fixture draft');
  expect(alert()!.textContent).toContain('Your unsaved edits are kept');
  expect(editor()!.contains(alert())).toBe(true);
  expect(host.querySelector('[aria-label="Saved configuration unavailable"]')).toBeNull();
  expect(host.textContent).not.toContain('private refresh error');
  const retry = alert()!.querySelector('button')!;
  await act(async () => retry.click()); expect(state.retry).toHaveBeenCalledTimes(1);
  state.config.isFetching = true; await render(); expect(alert()!.querySelector('button')!.disabled).toBe(true);
  state.config.scopeKey = 'fixture-another-tenant'; await render();
  expect(editor()).toBeNull(); expect(host.querySelector('[aria-label="Saved configuration unavailable"]')).not.toBeNull();
});

it('moves focus into the error dialog and restores it on close', async () => {
  await render(); const opener = [...host.querySelectorAll('button')].find(x => x.textContent === 'Edit fixture app')!;
  opener.focus(); await act(async () => opener.click());
  expect(document.activeElement?.textContent).toBe('Retry');
  const close = [...alert()!.querySelectorAll('button')].find(x => x.textContent === 'Close')!;
  await act(async () => close.click()); expect(document.activeElement).toBe(opener);
});

it('requires a successful read after a tenant round trip', async () => {
  Object.assign(state.config, { isError: false, error: null, deployedConfig: { displayName: 'Saved fixture' } });
  await select(); expect(editor()).not.toBeNull();
  Object.assign(state.config, { scopeKey: 'fixture-another-tenant', isPending: true });
  await render(); expect(editor()).toBeNull();
  Object.assign(state.config, { scopeKey: 'fixture-self', isPending: false, isError: true, error: new Error('cached refresh failure') });
  await render(); expect(editor()).toBeNull();
  expect(host.querySelector('[aria-label="Saved configuration unavailable"]')).not.toBeNull();
  Object.assign(state.config, { isError: false, error: null });
  await render(); expect(editor()).not.toBeNull();
});
