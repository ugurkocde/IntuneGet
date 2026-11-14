// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cachedAccount, createMsalTestDouble } from '@/test-utils/msal-test-double';
const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import('@/test-utils/msal-test-double').createMsalTestDouble> }));
vi.mock('@azure/msal-react', () => ({ useMsal: () => state.client.context, useIsAuthenticated: () => state.client.context.accounts.length > 0 }));
vi.mock('@/lib/msal-config', () => ({ graphScopes: ['fixture.read'], getAdminConsentUrl: vi.fn() }));
import { AuditLogTable } from './AuditLogTable';
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.client = createMsalTestDouble();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const render = () => act(async () => root.render(createElement(AuditLogTable)));
const ready = async () => {
  const init = state.client.instance.initialize();
  state.client.finishInitialization();
  await init;
};
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
const log = { id: 'fixture-log', user_id: 'fixture-user', user_email: 'fixture@example.invalid', action: 'deployment.completed', resource_type: 'deployment', resource_id: 'fixture-resource', details: { display_name: 'Fixture audit row' }, created_at: '2026-01-01T12:00:00Z' };
it('shows a failed request instead of an empty result and Retry loads rows', async () => {
  await ready();
  let failed = true;
  const fetch = vi.fn(async () => response(failed ? {} : { logs: [log], total_pages: 1 }, failed ? 500 : 200));
  vi.stubGlobal('fetch', fetch);
  await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('No audit logs found');
  failed = false;
  const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
  expect(retry.type).toBe('button');
  await act(async () => retry.click());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain('Fixture audit row');
});
it('shows a retryable network failure without exposing its details', async () => {
  await ready();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fixture private failure'); }));
  await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('fixture private failure');
  expect(host.textContent).not.toContain('No audit logs found');
});
it('keeps a cached account pending until MSAL startup finishes', async () => {
  state.client.context.accounts = [cachedAccount];
  const fetch = vi.fn(async () => response({ logs: [], total_pages: 1 }));
  vi.stubGlobal('fetch', fetch);
  await render();
  expect(fetch).not.toHaveBeenCalled();
  expect(state.client.instance.getActiveAccount).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).not.toContain('No audit logs found');
  await ready();
  await render();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('No audit logs found');
});
it('shows a missing token after startup as a request failure', async () => {
  await ready();
  state.client.instance.acquireTokenSilent.mockResolvedValue({ accessToken: '', expiresOn: new Date(Date.now() + 3600000) });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await render();
  expect(fetch).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('No audit logs found');
});
it('hides previous rows when the current refresh fails', async () => {
  await ready();
  let failed = false;
  vi.stubGlobal('fetch', vi.fn(async () => response(failed ? {} : { logs: [log], total_pages: 1 }, failed ? 500 : 200)));
  await render();
  expect(host.textContent).toContain('Fixture audit row');
  failed = true;
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Refresh audit logs"]')!.click());
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('Fixture audit row');
});
it('ignores an older Retry failure after the current filter request succeeds', async () => {
  await ready();
  let finish!: (value: Response) => void;
  let calls = 0;
  const fetch = vi.fn(async () => ++calls === 1 ? response({}, 500) : calls === 2 ? new Promise<Response>(resolve => { finish = resolve; }) : response({ logs: [log], total_pages: 1 }));
  vi.stubGlobal('fetch', fetch);
  await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Toggle filters"]')!.click());
  await act(async () => {
    const filter = host.querySelector<HTMLSelectElement>('select')!;
    filter.value = 'deployment.failed';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain('Fixture audit row');
  await act(async () => { finish(response({}, 500)); });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain('Fixture audit row');
});
