// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InteractionStatus } from '@azure/msal-browser';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMsalTestDouble } from '@/test-utils/msal-test-double';

const state = vi.hoisted(() => ({
  msal: null as unknown as ReturnType<typeof import('@/test-utils/msal-test-double').createMsalTestDouble>,
}));
vi.mock('@azure/msal-react', () => ({
  useMsal: () => state.msal.context,
  useIsAuthenticated: () => state.msal.context.inProgress !== InteractionStatus.Startup && state.msal.context.accounts.length > 0,
}));
vi.mock('@/lib/msal-config', () => ({ graphScopes: ['fixture.read'], getAdminConsentUrl: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { NotificationBell } from './NotificationBell';

const notice = {
  id: 'fixture-notice', user_id: 'fixture-owner', user_email: 'owner@example.test',
  type: 'deployment_complete', title: 'Fixture deployment ready', message: 'Fixture message',
  data: {}, read_at: null, created_at: '2026-11-14T10:00:00Z',
};
const saved = { notifications: [notice], unread_count: 1 };
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
const render = async () => {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(NotificationBell))));
  await settle();
};
const ready = async () => {
  const pending = state.msal.instance.initialize();
  state.msal.finishInitialization();
  await pending;
};
const open = async () => {
  const button = host.querySelector<HTMLButtonElement>('button[aria-haspopup="true"]');
  expect(button).not.toBeNull();
  await act(async () => button!.click());
  await settle();
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.msal = createMsalTestDouble();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); host.remove(); vi.unstubAllGlobals();
});

it('opens safely for a cached returning account during initialization, then retries a failed read', async () => {
  const read = vi.fn().mockResolvedValueOnce(response({ error: 'private server response' }, 500)).mockResolvedValueOnce(response(saved));
  const fetch = vi.fn(async (input: string, init?: RequestInit) => input === '/api/notifications/unread-count'
    ? response({ unread_count: 1 }) : read(input, init));
  vi.stubGlobal('fetch', fetch);
  await render(); await open();
  expect(state.msal.instance.getActiveAccount).not.toHaveBeenCalled();
  expect(state.msal.instance.getAllAccounts).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await ready(); await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not load notifications.');
  expect(host.textContent).not.toContain('No notifications yet');
  expect(host.textContent).not.toContain('private server response');
  const retry = [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry');
  expect(retry).toBeDefined();
  await act(async () => retry!.click()); await settle();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain(notice.title);
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[1]).toEqual(read.mock.calls[0]);
  expect(read.mock.calls[0]).toEqual(['/api/notifications?limit=20', { headers: { Authorization: 'Bearer fixture-token' } }]);
});

it('keeps cached notifications visible when the real query refresh fails', async () => {
  await ready();
  client.setQueryDefaults(['notifications', 20, false], { gcTime: Infinity });
  client.setQueryData(['notifications', 20, false], saved, { updatedAt: Date.now() - 60000 });
  vi.stubGlobal('fetch', vi.fn(async (input: string) => input === '/api/notifications/unread-count'
    ? response({ unread_count: 1 }) : response({}, 503)));
  await render(); await open();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not refresh notifications.');
  expect(host.textContent).toContain(notice.title);
  expect(host.textContent).not.toContain('No notifications yet');
});
