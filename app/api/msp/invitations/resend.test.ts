import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const f = vi.hoisted(() => ({ client: null as unknown, user: true, configured: false, allowed: true, writes: vi.fn(), send: vi.fn(), filters: [] as Array<[string, string, unknown]> }));
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => f.user ? { userId: 'inviter', userEmail: 'inviter@example.test' } : null }));
vi.mock('@/lib/supabase', () => ({ createServerClient: () => f.client }));
vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: async () => null, getUserKey: () => 'fixture', COMMUNITY_RATE_LIMIT: {} }));
vi.mock('@/lib/usage-limits', () => ({ checkCanAddMember: async () => ({ allowed: f.allowed, reason: 'Fixture limit' }) }));
vi.mock('@/lib/audit-logger', () => ({ logMemberInvited: vi.fn() }));
vi.mock('@/lib/email/service', () => ({ isEmailConfigured: () => f.configured, sendTeamInvitationEmail: f.send }));
import { PATCH } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const original = { id, organization_id: 'fixture-org', email: 'member@example.test', role: 'viewer', access_mode: 'full', expires_at: '2099-01-01T00:00:00Z', accepted_at: null, created_at: '2026-01-01', token: 'fixture-existing-token' };
function setup(member = { role: 'owner', access_mode: 'full' }, changes: Record<string, unknown> = {}) {
 const row: Record<string, unknown> = { ...original, ...changes };
 f.client = { from: (table: string) => {
  const filters: Array<[string, string, unknown]> = [];
  const chain = { select: (_columns: string) => chain, eq: (key: string, value: unknown) => add('eq', key, value), is: (key: string, value: unknown) => add('is', key, value), gt: (key: string, value: unknown) => add('gt', key, value), insert: f.writes, update: f.writes, upsert: f.writes, delete: f.writes,
   single: async () => table === 'msp_user_memberships' ? { data: { ...member, msp_organization_id: 'fixture-org', msp_organizations: { name: 'Fixture' } }, error: null } : { data: filters.every(([op, key, value]) => op === 'gt' ? String(row[key]) > String(value) : row[key] === value) ? { ...row } : null, error: null } };
  function add(op: string, key: string, value: unknown) { filters.push([op, key, value]); if (table === 'msp_invitations') f.filters.push([op, key, value]); return chain; }
  return chain;
 } };
}
async function resend(body: Record<string, unknown> = { id }) { const r = await PATCH(new NextRequest('http://localhost/api/msp/invitations', { method: 'PATCH', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); expect(f.writes).not.toHaveBeenCalled(); return r; }
beforeEach(() => { f.user = true; f.configured = false; f.allowed = true; f.writes.mockClear(); f.send.mockReset().mockResolvedValue({ success: true }); f.filters = []; setup(); });
it('reuses the invitation and offers its link without mutation', async () => { const r = await resend({ id, email: 'attacker@example.test', role: 'admin' }); expect(r.status).toBe(200); const b = await r.json(); expect(b.emailSent).toBe(false); expect(b.acceptUrl).toContain(original.token); expect(b.invitation).not.toHaveProperty('token'); expect(b.invitation.email).toBe(original.email); expect(f.filters).toEqual(expect.arrayContaining([['eq', 'id', id], ['eq', 'organization_id', 'fixture-org'], ['is', 'accepted_at', null], ['gt', 'expires_at', expect.any(String)]])); });
it('sends the existing token and expiry and omits token from success', async () => { f.configured = true; const r = await resend(); const b = await r.json(); expect(r.status).toBe(200); expect(b.emailSent).toBe(true); expect(b).not.toHaveProperty('acceptUrl'); expect(JSON.stringify(b)).not.toContain(original.token); expect(f.send).toHaveBeenCalledWith(original.email, expect.objectContaining({ token: original.token, expires_at: new Date(original.expires_at) })); });
it.each(['reject', 'false'])('preserves invitation when mail returns %s', async mode => { f.configured = true; if (mode === 'reject') f.send.mockRejectedValue(new Error('fixture')); else f.send.mockResolvedValue({ success: false }); const r = await resend(); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ emailSent: false, invitation: { id, expires_at: original.expires_at } }); });
it.each([['organization_id', 'other'], ['accepted_at', '2026-01-01'], ['expires_at', '2000-01-01'], ['id', '22222222-2222-4222-8222-222222222222']])('hides unavailable invitation %s', async (key, value) => { setup(undefined, { [key]: value }); const r = await resend(); expect(r.status).toBe(404); expect(await r.json()).toEqual({ error: 'Invitation not found, expired or already accepted' }); expect(f.send).not.toHaveBeenCalled(); });
it('rejects invalid ID', async () => { expect((await resend({ id: 'bad' })).status).toBe(400); });
it('rejects unauthenticated callers', async () => { f.user = false; expect((await resend()).status).toBe(401); });
it('keeps member limits', async () => { f.allowed = false; expect((await resend()).status).toBe(403); expect(f.send).not.toHaveBeenCalled(); });
it('rejects viewers', async () => { setup({ role: 'viewer', access_mode: 'full' }); expect((await resend()).status).toBe(403); });
it('checks stored role', async () => { setup({ role: 'admin', access_mode: 'full' }, { role: 'admin' }); expect((await resend({ id, role: 'viewer' })).status).toBe(403); });
it('checks stored access', async () => { setup({ role: 'owner', access_mode: 'customer_only' }); expect((await resend({ id, access_mode: 'customer_only' })).status).toBe(403); });
