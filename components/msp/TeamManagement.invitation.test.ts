// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ isAuthenticated: true, getAccessToken: vi.fn(async () => 'fixture-token') }));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => auth }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('./MemberCard', () => ({ MemberCard: () => null }));
vi.mock('./BulkInviteMembers', () => ({ BulkInviteMembers: () => null }));
vi.mock('./RoleSelector', () => ({ RoleSelector: () => null }));
import { TeamManagement } from './TeamManagement';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
it.each([false, true])('retains the invitation result until Done when emailSent=%s', async emailSent => {
  const node = document.createElement('div'); document.body.append(node);
  const root = createRoot(node);
  const requests = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/msp/members') return Response.json({ members: [], current_user_role: 'owner' });
    if (init?.method === 'POST') return Response.json({ emailSent, acceptUrl: 'https://example.test/invite/fixture' });
    return Response.json({ pending: [] });
  });
  vi.stubGlobal('fetch', requests);
  const button = (text: string) => [...node.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
  try {
    await act(async () => root.render(createElement(TeamManagement)));
    await act(async () => button('Invite Member').click());
    const input = node.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'member@example.test');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(requests.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
    expect(node.textContent).toContain(emailSent ? 'Email sent successfully' : 'Share this link');
    if (!emailSent) expect(node.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe('https://example.test/invite/fixture');
    expect(requests.mock.calls.filter(([url]) => url === '/api/msp/invitations').length).toBeGreaterThanOrEqual(3);
    await act(async () => button('Done').click());
    expect(node.textContent).not.toContain('Share this link');
    expect(button('Done')).toBeUndefined();
  } finally {
    await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  }
});
