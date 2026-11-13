import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({
  client: null as unknown,
  inserts: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: async () => ({ userId: 'inviter', userEmail: 'inviter@example.com', userName: 'Inviter' }),
}));
vi.mock('@/lib/supabase', () => ({ createServerClient: () => fixture.client }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: async () => null,
  getUserKey: (userId: string) => `user:${userId}`,
  COMMUNITY_RATE_LIMIT: {},
}));
vi.mock('@/lib/usage-limits', () => ({ checkCanAddMember: async () => ({ allowed: true }) }));
vi.mock('@/lib/audit-logger', () => ({ logMemberInvited: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/service', () => ({
  isEmailConfigured: () => false,
  sendTeamInvitationEmail: vi.fn(),
}));

import { POST } from './route';

type Role = 'owner' | 'admin' | 'operator' | 'viewer';
type AccessMode = 'full' | 'customer_only';

/** Supabase stand-in: the inviter's membership, no existing member or invitation. */
function inviter(role: Role, accessMode: AccessMode = 'full') {
  fixture.inserts = [];
  fixture.client = {
    from: (table: string) => {
      let result: { data: unknown; error: unknown } = { data: null, error: { code: 'PGRST116' } };
      const chain: Record<string, unknown> = {};
      for (const method of ['eq', 'ilike', 'is']) chain[method] = () => chain;
      chain.select = (columns: string) => {
        if (table === 'msp_user_memberships' && columns.includes('msp_organizations')) {
          result = {
            data: {
              msp_organization_id: 'org-1',
              role,
              access_mode: accessMode,
              msp_organizations: { id: 'org-1', name: 'Fixture MSP' },
            },
            error: null,
          };
        }
        return chain;
      };
      chain.insert = (values: Record<string, unknown>) => {
        fixture.inserts.push(values);
        result = {
          data: {
            id: 'invitation-1',
            email: values.email,
            role: values.role,
            access_mode: values.access_mode,
            expires_at: values.expires_at,
            created_at: '2026-11-13T00:00:00Z',
          },
          error: null,
        };
        return chain;
      };
      chain.single = async () => result;
      return chain;
    },
  };
}

const invite = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/msp/invitations', {
  method: 'POST',
  headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'new.member@example.com', ...body }),
}));

const ROLE_ERROR = { error: 'You can only invite members to a role below your own' };
const ACCESS_ERROR = {
  error: 'Your access is limited to customer tenants, so you can only invite members with customer tenant access',
};

beforeEach(() => { inviter('owner'); });

describe('invitation role', () => {
  it('stops an admin from inviting another admin', async () => {
    inviter('admin');
    const response = await invite({ role: 'admin' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(ROLE_ERROR);
    expect(fixture.inserts).toEqual([]);
  });

  it.each(['operator', 'viewer'] as const)('lets an admin invite a %s', async (role) => {
    inviter('admin');
    const response = await invite({ role });
    expect(response.status).toBe(201);
    expect(fixture.inserts).toEqual([expect.objectContaining({ role, organization_id: 'org-1' })]);
  });

  it.each(['admin', 'operator', 'viewer'] as const)('lets an owner invite a %s', async (role) => {
    inviter('owner');
    const response = await invite({ role });
    expect(response.status).toBe(201);
    expect(fixture.inserts).toEqual([expect.objectContaining({ role })]);
  });

  it('still refuses an owner invitation for everyone', async () => {
    inviter('owner');
    const response = await invite({ role: 'owner' });
    expect(response.status).toBe(400);
    expect(fixture.inserts).toEqual([]);
  });

  it.each(['operator', 'viewer'] as const)('still refuses a %s, who cannot invite at all', async (role) => {
    inviter(role);
    const response = await invite({ role: 'viewer' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'You do not have permission to invite members' });
    expect(fixture.inserts).toEqual([]);
  });
});

describe('invitation access mode', () => {
  it('stops a customer only inviter from granting full access', async () => {
    inviter('admin', 'customer_only');
    const response = await invite({ role: 'operator', access_mode: 'full' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(ACCESS_ERROR);
    expect(fixture.inserts).toEqual([]);
  });

  it('stops a customer only inviter who leaves the access mode out, because it defaults to full', async () => {
    inviter('admin', 'customer_only');
    const response = await invite({ role: 'viewer' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(ACCESS_ERROR);
    expect(fixture.inserts).toEqual([]);
  });

  it('applies to a customer only owner as well', async () => {
    inviter('owner', 'customer_only');
    const response = await invite({ role: 'admin', access_mode: 'full' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(ACCESS_ERROR);
  });

  it('lets a customer only inviter invite with customer only access', async () => {
    inviter('admin', 'customer_only');
    const response = await invite({ role: 'operator', access_mode: 'customer_only' });
    expect(response.status).toBe(201);
    expect(fixture.inserts).toEqual([expect.objectContaining({ role: 'operator', access_mode: 'customer_only' })]);
  });

  it.each(['full', 'customer_only'] as const)('lets a full access inviter invite with %s access', async (accessMode) => {
    inviter('admin', 'full');
    const response = await invite({ role: 'operator', access_mode: accessMode });
    expect(response.status).toBe(201);
    expect(fixture.inserts).toEqual([expect.objectContaining({ access_mode: accessMode })]);
  });

  it('reports the role problem first when both rules are broken', async () => {
    inviter('admin', 'customer_only');
    const response = await invite({ role: 'admin', access_mode: 'full' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(ROLE_ERROR);
  });
});
