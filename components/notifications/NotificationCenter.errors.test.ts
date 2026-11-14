// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Notification } from '@/lib/notification-service';
import { NotificationCenter } from './NotificationCenter';

const state = vi.hoisted(() => ({
  query: {
    data: undefined as { notifications: Notification[]; unread_count: number } | undefined,
    isLoading: false, isError: true, isFetching: false, refetch: vi.fn(),
  },
  mark: vi.fn(), markAll: vi.fn(), push: vi.fn(),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => state.query,
  useMarkAsRead: () => ({ mutate: state.mark }),
  useMarkAllAsRead: () => ({ mutate: state.markAll, isPending: false }),
}));
beforeEach(() => {
  Object.assign(state.query, { data: undefined, isLoading: false, isError: true, isFetching: false });
  state.query.refetch.mockReset().mockResolvedValue(undefined);
  state.mark.mockClear(); state.markAll.mockClear(); state.push.mockClear();
});

async function withCenter(check: (host: HTMLDivElement) => Promise<void>) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(NotificationCenter)));
    await check(host);
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
}

it('shows a load error instead of the empty state and retries only the read', async () => {
  await withCenter(async host => {
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not load notifications');
    expect(host.textContent).not.toContain('No notifications yet');
    const retry = [...host.querySelectorAll('button')].find(b => b.textContent === 'Retry');
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(state.query.refetch).toHaveBeenCalledTimes(1);
    expect(state.mark).not.toHaveBeenCalled();
    expect(state.markAll).not.toHaveBeenCalled();
    expect(state.push).not.toHaveBeenCalled();
  });
});

it('keeps cached notifications visible when a background refresh fails', async () => {
  state.query.data = { unread_count: 1, notifications: [{
    id: 'fixture-notice', user_id: 'fixture-owner', user_email: 'owner@example.invalid',
    type: 'deployment_waiting', title: 'Fixture notification', message: 'Fixture message',
    data: {}, read_at: null, created_at: '2026-11-13T12:00:00Z',
  }] };
  await withCenter(async host => {
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not refresh notifications');
    expect(host.textContent).toContain('Fixture notification');
    expect(host.textContent).toContain('Showing latest 1 notifications');
    expect(state.query.refetch).not.toHaveBeenCalled();
  });
});

it('disables retry while the read is in flight after an error', async () => {
  state.query.isFetching = true;
  await withCenter(async host => {
    const retry = [...host.querySelectorAll('button')].find(b => b.textContent === 'Retrying...');
    expect(retry?.disabled).toBe(true);
    expect(host.textContent).not.toContain('No notifications yet');
    expect(state.query.refetch).not.toHaveBeenCalled();
  });
});

it('keeps the normal empty state after a successful empty response', async () => {
  state.query.isError = false;
  state.query.data = { notifications: [], unread_count: 0 };
  await withCenter(async host => {
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('No notifications yet');
  });
});
