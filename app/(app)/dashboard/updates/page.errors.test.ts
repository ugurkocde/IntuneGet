// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ refresh: vi.fn(), refetch: vi.fn(), error: null as Error | null, userId: 'fixture-user' }));
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => children, Var: ({ children }: { children: ReactNode }) => children, useLocale: () => 'en-US' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ user: { id: state.userId, tenantId: 'fixture-tenant' } }) }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: false, selectedTenantId: null, managedTenants: [] }) }));
vi.mock('@/components/providers/UserSettingsProvider', () => ({ useUserSettings: () => ({ settings: {} }) }));
vi.mock('@/hooks/use-updates', () => ({
  useAvailableUpdates: () => ({ data: { updates: [], count: 0, criticalCount: 0 }, isLoading: false, isFetching: false, error: state.error, refetch: state.refetch }),
  useAutoUpdateHistory: () => ({ data: { history: [] }, isLoading: false, fetchMore: vi.fn(), hasMore: false, refetch: vi.fn() }),
  useRefreshAvailableUpdates: () => ({ refreshUpdates: state.refresh, isRefreshing: false }),
  useTriggerUpdate: () => ({ triggerUpdate: vi.fn() }),
  useUpdatePolicy: () => ({ updatePolicy: vi.fn() }),
  useUpdatePolicies: () => ({ data: { policies: [] }, isLoading: false }),
}));
vi.mock('@/components/dashboard', () => ({
  PageHeader: ({ title, description, actions }: { title: ReactNode; description: ReactNode; actions: ReactNode }) => createElement('header', null, title, description, actions),
  AnimatedStatCard: () => null,
  StatCardGrid: ({ children }: { children: ReactNode }) => children,
  AnimatedEmptyState: ({ title, description, action }: { title: ReactNode; description: ReactNode; action?: { label: ReactNode; onClick: () => void } }) => createElement('section', null, title, description, action && createElement('button', { onClick: action.onClick }, action.label)),
}));
vi.mock('@/components/updates', () => ({ UpdateCard: () => null, UpdateCardSkeleton: () => createElement('div', null, 'Checking updates'), AutoUpdateHistory: () => null }));
vi.mock('@/components/updates/AutoUpdateAppsModal', () => ({ AutoUpdateAppsModal: () => null }));
vi.mock('framer-motion', () => ({ useReducedMotion: () => true, motion: { div: ({ children }: { children: ReactNode }) => createElement('div', null, children) } }));
import Page from './page';
let root: Root;
let host: HTMLDivElement;
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const render = async () => { await act(async () => root.render(createElement(Page))); };
const click = async (name: string) => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === name);
  expect(button).toBeDefined(); await act(async () => button!.click());
};
beforeEach(() => {
  state.error = null; state.userId = 'fixture-user'; state.refresh.mockReset().mockResolvedValue({ success: true });
  state.refetch.mockReset().mockResolvedValue({ error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it('shows a failed live refresh instead of a successful empty state and can retry', async () => {
  state.refresh.mockRejectedValueOnce(new Error('Fixture scan was throttled'));
  await render();
  expect(host.textContent).toContain('Fixture scan was throttled');
  expect(host.textContent).not.toContain('All apps are up to date');
  await click('Try Again');
  expect(state.refresh).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('All apps are up to date');
  expect(host.textContent).not.toContain('Fixture scan was throttled');
});
it('keeps the last successful check time when a later refresh fails', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-13T12:00:00Z'));
  await render();
  const lastChecked = host.querySelector('time')?.getAttribute('datetime');
  expect(lastChecked).toBe('2026-11-13T12:00:00.000Z');
  state.refresh.mockRejectedValueOnce(new Error('Fixture scan timed out'));
  await click('Refresh');
  expect(host.textContent).toContain('Fixture scan timed out');
  expect(host.textContent).not.toContain('All apps are up to date');
  expect(host.querySelector('time')?.getAttribute('datetime')).toBe(lastChecked);
});
it('does not auto refresh or show success after an initial query failure', async () => {
  state.error = new Error('Your session expired. Please sign in again.');
  await render();
  expect(host.textContent).toContain('Please sign in again');
  expect(host.textContent).not.toContain('All apps are up to date');
  expect(state.refresh).not.toHaveBeenCalled();
});
it('does not claim success while the first live scan has not completed', async () => {
  let finish!: (value: { success: boolean }) => void;
  state.refresh.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  expect(host.textContent).not.toContain('All apps are up to date');
  expect(host.querySelector('time')).toBeNull();
  await act(async () => finish({ success: true }));
  expect(host.textContent).toContain('All apps are up to date');
});
it('does not display a late previous account refresh error or time in the new account', async () => {
  let fail!: (error: Error) => void;
  state.refresh.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  await render(); state.userId = 'fixture-other-user'; await render();
  const checked = host.querySelector('time')?.getAttribute('datetime');
  expect(checked).toBeDefined();
  await act(async () => fail(new Error('Previous account fixture failure')));
  expect(host.textContent).not.toContain('Previous account fixture failure');
  expect(host.querySelector('time')?.getAttribute('datetime')).toBe(checked);
});
it('keeps a retry busy through its refetch and prevents another refresh', async () => {
  state.error = new Error('Cached query failure');
  await render();
  let finish!: (value: { error: Error | null }) => void;
  state.refetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await click('Try Again');
  expect(host.textContent).toContain('Checking updates');
  expect(host.textContent).not.toContain('Try Again');
  const refresh = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Refresh');
  expect(refresh?.disabled).toBe(true);
  await act(async () => refresh!.click());
  expect(state.refresh).toHaveBeenCalledTimes(1);
  await act(async () => finish({ error: new Error('Refetch fixture failed') }));
  expect(host.textContent).toContain('Refetch fixture failed');
  expect(host.textContent).toContain('Try Again');
});
it('does not refetch the next account when an older account scan finishes', async () => {
  let finish!: (value: { success: boolean }) => void;
  state.refresh.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  state.userId = 'fixture-other-user'; state.error = new Error('New account query failure');
  await render();
  await act(async () => finish({ success: true }));
  expect(state.refetch).not.toHaveBeenCalled();
  expect(host.textContent).toContain('New account query failure');
  expect(host.querySelector('time')).toBeNull();
});
it('discards a refetch completion after the account changes', async () => {
  let finish!: (value: { error: Error | null }) => void;
  state.refetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  state.userId = 'fixture-other-user'; state.error = new Error('Other account query failure');
  await render();
  await act(async () => finish({ error: new Error('Previous refetch failure') }));
  state.userId = 'fixture-user'; state.error = new Error('Original account query failure'); await render();
  expect(host.textContent).not.toContain('Previous refetch failure');
  expect(host.querySelector('time')).toBeNull();
});
it.each(['scan', 'refetch'])('restarts an abandoned first %s when its account becomes active again', async phase => {
  let finish!: () => void;
  if (phase === 'scan') state.refresh.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ success: true }); }));
  else state.refetch.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ error: null }); }));
  await render();
  state.userId = 'fixture-other-user'; state.error = new Error('Other account query failed');
  await render();
  await act(async () => finish());
  state.userId = 'fixture-user'; state.error = null;
  await render();
  expect(state.refresh).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('All apps are up to date');
});
