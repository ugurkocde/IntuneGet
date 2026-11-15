// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ toast: vi.fn(), auth: { isAuthenticated: true, getAccessToken: async () => 'fixture' } }));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => fixture.auth }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }) }));
vi.mock('./MemberCard', () => ({ MemberCard: () => null }));
vi.mock('./InviteTeamMember', () => ({ InviteTeamMember: () => null }));
vi.mock('./BulkInviteMembers', () => ({ BulkInviteMembers: () => null }));
import { TeamManagement } from './TeamManagement';
it.each(['failure', 'fallback', 'sent'])('resend preserves pending invitation on %s', async outcome => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.toast.mockClear();
  const invitation = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.test', invited_by_email: 'inviter@example.test', role: 'viewer', access_mode: 'full', expires_at: '2099-01-01', created_at: '2026-01-01', accepted_at: null };
  let exists = true;
  const requests = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/msp/members') return Response.json({ members: [], current_user_role: 'owner' });
    if (init?.method === 'DELETE') { exists = false; return Response.json({ success: true }); }
    if (init?.method === 'PATCH' || init?.method === 'POST') return outcome === 'failure' ? Response.json({ error: 'Fixture unavailable' }, { status: 500 }) : Response.json({ emailSent: outcome === 'sent', acceptUrl: outcome === 'fallback' ? 'https://example.test/invite?token=fixture' : undefined });
    return Response.json({ pending: exists ? [invitation] : [] });
  });
  vi.stubGlobal('fetch', requests);
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const button = (text: string) => [...node.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
  try {
    await act(async () => root.render(createElement(TeamManagement)));
    await act(async () => [...node.querySelectorAll('button')].find(b => b.textContent?.includes('Pending Invitations'))!.click());
    await act(async () => button('Resend').click());
    expect(exists).toBe(true);
    expect(requests.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
    expect(requests.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toEqual([['/api/msp/invitations', expect.objectContaining({ body: JSON.stringify({ id: invitation.id }) })]]);
    if (outcome === 'failure') {
      expect(node.textContent).toContain(invitation.email);
      expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    } else if (outcome === 'fallback') {
      expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Invitation link ready' }));
      const input = node.querySelector<HTMLInputElement>('input[readonly]')!;
      expect(input.value).toBe('https://example.test/invite?token=fixture');
      await act(async () => button('Done').click());
      expect(node.querySelector('input[readonly]')).toBeNull();
    } else expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Invitation resent' }));
  } finally { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); }
});


