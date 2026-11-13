// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NotificationCenter } from './NotificationCenter';

const state = vi.hoisted(() => ({ push: vi.fn(), mark: vi.fn() }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ data: { unread_count: 1, notifications: [{
    id: 'fixture-notice', user_id: 'fixture-owner', user_email: 'owner@example.test',
    type: 'deployment_waiting', title: 'Still waiting: Fixture App', message: 'Open Uploads to review your options.',
    data: { job_id: 'fixture-job' }, read_at: null, created_at: '2026-11-13T12:00:00Z',
  }] }, isLoading: false }),
  useMarkAsRead: () => ({ mutate: state.mark }),
  useMarkAllAsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));

it('marks a waiting notice read and opens the existing Uploads options', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(NotificationCenter)));
    const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Still waiting: Fixture App'));
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(state.mark).toHaveBeenCalledWith(['fixture-notice']);
    expect(state.push).toHaveBeenCalledWith('/dashboard/uploads');
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
});
