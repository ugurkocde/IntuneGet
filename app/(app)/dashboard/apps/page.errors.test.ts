// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NormalizedPackage } from '@/types/winget';

const state = vi.hoisted(() => ({ params: new URLSearchParams('q=fixture'), observers: [] as IntersectionObserverCallback[] }));
vi.mock('next/navigation', () => ({ useSearchParams: () => state.params }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => createElement('span', null, children) }));
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => children, Var: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/providers/UserSettingsProvider', () => ({ useUserSettings: () => ({ settings: { viewMode: 'grid' }, setViewMode: vi.fn() }) }));
vi.mock('@/hooks/use-near-viewport', () => ({ useNearViewport: () => ({ ref: { current: null }, near: false }) }));
vi.mock('@/hooks/use-deployed-packages', () => ({ useDeployedPackages: () => ({ deployedSet: new Set() }) }));
vi.mock('@/hooks/use-tenant-deployments', () => ({ useTenantDeployments: () => ({ tenantDeployments: new Map() }) }));
vi.mock('@/hooks/use-deployed-config', () => ({ useDeployedConfig: () => ({ deployedConfig: null, isLoading: false }) }));
vi.mock('@/hooks/use-bulk-add', () => ({ useBulkAdd: () => ({ bulkAdd: vi.fn() }) }));
vi.mock('@/hooks/use-qa', () => ({ useQaStatuses: () => ({ data: { statuses: {} } }) }));
vi.mock('@/hooks/use-curated-releases', () => ({ useCuratedReleases: () => ({ data: null }) }));
vi.mock('@/components/FeaturedApps', () => ({ FeaturedApps: () => null }));
vi.mock('@/components/AppCollection', () => ({ AppCollection: () => null }));
vi.mock('@/components/AppSearch', () => ({ AppSearch: () => null }));
vi.mock('@/components/AppCard', () => ({ AppCard: ({ package: pkg }: { package: NormalizedPackage }) => createElement('div', null, pkg.name) }));
vi.mock('@/components/AppListItem', () => ({ AppListItem: () => null }));
vi.mock('@/components/VirtualAppList', () => ({ APP_GRID_TEMPLATE_COLUMNS: '', VirtualAppList: ({ items, renderItem }: { items: NormalizedPackage[]; renderItem: (pkg: NormalizedPackage) => ReactNode }) => items.map(renderItem) }));
import AppCatalogPage from './page';

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
const pkg = { id: 'Fixture.App', name: 'Fixture catalog row', publisher: 'Fixture', version: '1.0' };
const page = (offset = 0, hasMore = false) => ({ packages: [pkg], count: 1, total: hasMore ? 2 : 1, offset, limit: 20, hasMore });
let read: (url: string) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.params = new URLSearchParams('q=fixture');
  state.observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { state.observers.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  read = async () => response({}, 500);
  fetchMock = vi.fn(async (url: string) => url.startsWith('/api/winget/categories')
    ? response({ categories: [], totalApps: 2 }) : read(url));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
const render = async () => {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(AppCatalogPage))));
  await settle();
};
const retry = () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
const requests = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(path));
it('shows an HTTP search failure and retries the same read without a false empty result', async () => {
  let fails = true;
  read = async () => fails ? response({}, 500) : response({ packages: [pkg], count: 1 });
  await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('No packages matching');
  expect(retry().type).toBe('button');
  fails = false;
  await act(async () => retry().click());
  await settle();
  const calls = requests('/api/winget/search');
  expect(calls).toHaveLength(2);
  expect(calls[0][0]).toBe(calls[1][0]);
  expect(host.textContent).toContain(pkg.name);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('shows a network failure without exposing private error details', async () => {
  read = async () => { throw new Error('private upstream response'); };
  await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('private upstream response');
  expect(host.textContent).not.toContain('No packages matching');
});
it('keeps a successful empty search as an empty result', async () => {
  read = async () => response({ packages: [], count: 0 });
  await render();
  expect(host.textContent).toContain('No packages matching');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('keeps cached search rows visible and disables Retry during a retry', async () => {
  let fails = false;
  let finish!: (value: Response) => void;
  read = async () => fails ? response({}, 503) : response({ packages: [pkg], count: 1 });
  await render();
  fails = true;
  await act(async () => { await client.invalidateQueries({ queryKey: ['packages', 'search'] }); });
  await settle();
  expect(host.textContent).toContain(pkg.name);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  read = () => new Promise(resolve => { finish = resolve; });
  await act(async () => retry().click());
  await settle();
  expect(retry().disabled).toBe(true);
  expect(host.textContent).toContain(pkg.name);
  await act(async () => finish(response({ packages: [pkg], count: 1 })));
  await settle();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('shows an initial browse failure with a working explicit retry', async () => {
  state.params = new URLSearchParams();
  await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  read = async () => response(page());
  await act(async () => retry().click());
  await settle();
  expect(requests('/api/winget/popular')).toHaveLength(2);
  expect(host.textContent).toContain(pkg.name);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('keeps loaded browse rows after a page failure and retries only on request', async () => {
  state.params = new URLSearchParams();
  let fails = true;
  read = async url => new URL(url, 'https://example.invalid').searchParams.get('offset') === '0'
    ? response(page(0, true)) : fails ? response({}, 503) : response({ ...page(1), packages: [{ ...pkg, id: 'Fixture.Next', name: 'Next fixture row' }] });
  await render();
  const intersect = () => state.observers.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  await act(async () => intersect());
  await settle();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).toContain(pkg.name);
  expect(host.textContent).not.toContain("You've seen all the apps");
  await act(async () => intersect());
  await settle();
  expect(requests('/api/winget/popular')).toHaveLength(2);
  fails = false;
  await act(async () => retry().click());
  await settle();
  const calls = requests('/api/winget/popular');
  expect(calls).toHaveLength(3);
  expect(calls[2][0]).toBe(calls[1][0]);
  expect(host.textContent).toContain('Next fixture row');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
