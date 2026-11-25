// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
const f = vi.hoisted(() => ({ defaults: null as unknown, status: 'loaded', success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/providers/UserSettingsProvider', () => ({ useUserSettings: () => ({ packageDefaults: f.defaults, packageDefaultsStatus: f.status }) }));
vi.mock('sonner', () => ({ toast: { success: f.success, error: f.error, info: f.info } }));
import { useCartStore } from '@/stores/cart-store';
import { useQuickAdd } from './useQuickAdd';
import { useBulkAdd } from './use-bulk-add';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { NormalizedPackage } from '@/types/winget';
import type { Win32CartItem } from '@/types/upload';
const pkg: NormalizedPackage = { id: 'Fixture.App', name: 'Fixture App', publisher: 'Fixture', version: '2' };
const installer = { architecture: 'x64', type: 'exe', scope: 'machine', url: 'https://example.test/fixture.exe', sha256: 'a'.repeat(64) };
const response = () => ({ ok: true, json: async () => ({ recommendedInstaller: installer }) });
let root: Root;
const api = { current: null as null | { quick: ReturnType<typeof useQuickAdd>; bulk: ReturnType<typeof useBulkAdd> } };
function Probe({ store = false }: { store?: boolean }) {
  const quick = useQuickAdd(store ? { ...pkg, appSource: 'store', packageIdentifier: 'Fixture.Store' } : pkg);
  const bulk = useBulkAdd();
  useEffect(() => { api.current = { quick, bulk }; });
  return null;
}
const render = (store = false) => act(async () => root.render(createElement(Probe, { store })));
const select = () => api.current!.quick.quickAdd({ stopPropagation: vi.fn() } as never);
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  Object.assign(f, { defaults: null, status: 'loaded' });
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => response()));
  useCartStore.setState({ items: [], scope: 'account-a|tenant-a', activeScope: 'account-a|tenant-a', isOpen: false });
  const div = document.createElement('div'); document.body.append(div); root = createRoot(div);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
describe.each(['quick', 'bulk'] as const)('%s catalog selection', (lane) => {
  const add = () => lane === 'quick' ? select() : api.current!.bulk.bulkAdd([pkg]);
  it('applies saved defaults while preserving package detection and processes', async () => {
    f.defaults = { deployMode: 'NonInteractive', allowDefer: true, deferTimes: 5, verifyInstall: false, processesToClose: [{ name: 'wrong' }], detectionRules: [] };
    await render(); await act(async () => { await add(); });
    const item = useCartStore.getState().items[0] as Win32CartItem;
    expect(item.psadtConfig).toMatchObject({ deployMode: 'NonInteractive', allowDefer: true, deferTimes: 5 });
    expect(item.psadtConfig.verifyInstall).toBe(DEFAULT_PSADT_CONFIG.verifyInstall);
    expect(item.psadtConfig.processesToClose).not.toEqual([{ name: 'wrong' }]);
    expect(item.detectionRules.length).toBeGreaterThan(0);
    expect(item.psadtConfig.detectionRules).toEqual(item.detectionRules);
  });
  it.each(['loaded', 'error'])('keeps standard defaults when settings are %s and absent', async (status) => {
    f.status = status; await render(); await act(async () => { await add(); });
    expect((useCartStore.getState().items[0] as Win32CartItem).psadtConfig.deployMode).toBe(DEFAULT_PSADT_CONFIG.deployMode);
  });
  it('blocks while defaults load without fetching or adding', async () => {
    f.status = 'loading'; await render(); await act(async () => { await add(); });
    expect(fetch).not.toHaveBeenCalled(); expect(useCartStore.getState().items).toHaveLength(0);
    if (lane === 'quick') expect(api.current!.quick.isLoading).toBe(true);
  });
  it('discards an in-flight result after a cart scope switch and switch back', async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve; })));
    await render(); let pending!: ReturnType<typeof add>;
    await act(async () => { pending = add(); });
    useCartStore.setState({ scope: 'account-b|tenant-b', activeScope: 'account-b|tenant-b' });
    useCartStore.setState({ scope: 'account-a|tenant-a', activeScope: 'account-a|tenant-a' });
    await act(async () => { finish(response()); await pending; });
    expect(useCartStore.getState().items).toHaveLength(0); expect(f.success).not.toHaveBeenCalled();
  });
});
it('leaves the Store payload and loading behavior unchanged', async () => {
  f.status = 'loading'; await render(true); await act(async () => { await select(); });
  expect(fetch).not.toHaveBeenCalled();
  expect(useCartStore.getState().items[0]).toMatchObject({ appSource: 'store', wingetId: 'Fixture.Store', installExperience: 'user' });
  expect(useCartStore.getState().items[0]).not.toHaveProperty('psadtConfig');
});
