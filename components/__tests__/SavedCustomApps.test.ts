// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ tenant: 'tenant-a', authenticated: true, token: vi.fn(async () => 'offline-fixture') }));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ getAccessToken: state.token, isAuthenticated: state.authenticated }) }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ selectedTenantId: state.tenant }) }));
import { SavedCustomApps } from '../SavedCustomApps';
import { CustomAppModal } from '../CustomAppModal';
import { useCartStore } from '@/stores/cart-store';

const definition = { displayName: 'Fixture', publisher: 'Fixture', installerType: 'msi' as const, architecture: 'x64' as const, installScope: 'machine' as const };
const row = { id: 'fixture-id', definition };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const render = async (props: Parameters<typeof SavedCustomApps>[0]) => { await act(async () => root.render(createElement(SavedCustomApps, props))); };
const click = async (label: string) => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === label); expect(button).toBeTruthy(); await act(async () => button!.click()); };
beforeEach(() => { state.tenant = 'tenant-a'; state.authenticated = true; vi.stubGlobal('fetch', vi.fn(async () => response({ definitions: [row], hasMore: false }))); const container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
describe('saved custom apps', () => {
  it('loads the real modal with static details and leaves fresh version inputs empty', async () => {
    useCartStore.setState({ items: [] });
    await act(async () => root.render(createElement(CustomAppModal, { onClose: vi.fn() })));
    await click('Deploy new version');
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    expect(value('custom-app-name')).toBe('Fixture');
    expect(value('custom-app-publisher')).toBe('Fixture');
    expect(value('custom-app-version')).toBe('');
    expect(value('custom-app-installer-url')).toBe('');
    expect(value('custom-app-sha256')).toBe('');
    expect(useCartStore.getState().items).toEqual([]);
  });
  it('loads metadata for a new version without dispatching a package', async () => {
    const load = vi.fn();
    await render({ definition: () => definition, onLoad: load });
    await click('Deploy new version');
    expect(load).toHaveBeenCalledWith(definition);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith('/api/custom-apps'))).toBe(true);
  });
  it('saves only metadata with the selected tenant header and no deployment', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => response(init?.method === 'POST' ? { definition: row } : { definitions: [], hasMore: false }));
    await render({ definition: () => definition, onLoad: vi.fn() });
    expect(fetch).toHaveBeenCalledTimes(1);
    await click('Save definition');
    expect(document.body.textContent).toContain('Definition saved. Nothing has been deployed.');
    const [, request] = vi.mocked(fetch).mock.calls[1];
    expect(JSON.parse(request!.body as string)).toEqual({ definition });
    expect(request!.headers).toMatchObject({ 'X-MSP-Tenant-Id': 'tenant-a' });
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url) === '/api/custom-apps')).toBe(true);
  });
  it('ignores an old tenant response that arrives after switching tenants', async () => {
    let oldResponse: (value: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { oldResponse = resolve; })).mockImplementation(async () => response({ definitions: [{ ...row, definition: { ...definition, displayName: 'New tenant' } }], hasMore: false }));
    await render({ definition: () => definition, onLoad: vi.fn() });
    expect(fetch).toHaveBeenCalledTimes(1);
    state.tenant = 'tenant-b'; await render({ definition: () => definition, onLoad: vi.fn() });
    expect(document.body.textContent).toContain('New tenant');
    await act(async () => { oldResponse(response({ definitions: [row], hasMore: false })); });
    expect(document.body.textContent).not.toContain('Fixture');
  });
  it('hides saved definitions without authentication', async () => {
    state.authenticated = false;
    await render({ definition: () => definition, onLoad: vi.fn() });
    expect(document.querySelector('[aria-label="Saved custom apps"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
