import { NextRequest } from 'next/server';

const { parseAccessTokenMock, createServerClientMock } = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  createServerClientMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: createServerClientMock,
}));

import { GET } from '@/app/api/updates/available/route';

function createAwaitableQuery(
  result: { data: unknown; error: unknown },
  operations: Array<{ method: string; args: unknown[] }>
) {
  const query: Record<string, unknown> = {};

  query.select = (...args: unknown[]) => {
    operations.push({ method: 'select', args });
    return query;
  };
  query.eq = (...args: unknown[]) => {
    operations.push({ method: 'eq', args });
    return query;
  };
  query.order = (...args: unknown[]) => {
    operations.push({ method: 'order', args });
    return query;
  };
  query.is = (...args: unknown[]) => {
    operations.push({ method: 'is', args });
    return query;
  };
  query.in = (...args: unknown[]) => {
    operations.push({ method: 'in', args });
    return query;
  };
  query.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve(result).then(resolve);

  return query;
}

describe('GET /api/updates/available', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies tenant filter to updates and policy lookup', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'home-tenant',
      userName: 'User',
    });

    const updateOps: Array<{ method: string; args: unknown[] }> = [];
    const policyOps: Array<{ method: string; args: unknown[] }> = [];

    const updatesQuery = createAwaitableQuery(
      {
        data: [
          {
            id: 'upd-1',
            user_id: 'user-1',
            tenant_id: 'tenant-a',
            winget_id: 'Microsoft.Edge',
            intune_app_id: 'app-1',
            display_name: 'Edge',
            current_version: '1.0.0',
            latest_version: '1.1.0',
            is_critical: true,
            detected_at: '2026-02-01T00:00:00Z',
            notified_at: null,
            dismissed_at: null,
          },
        ],
        error: null,
      },
      updateOps
    );

    const policiesQuery = createAwaitableQuery(
      {
        data: [
          {
            id: 'pol-1',
            winget_id: 'Microsoft.Edge',
            tenant_id: 'tenant-a',
            policy_type: 'notify',
            is_enabled: true,
            pinned_version: null,
            last_auto_update_at: null,
            consecutive_failures: 0,
          },
        ],
        error: null,
      },
      policyOps
    );

    createServerClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'update_check_results') return updatesQuery;
        if (table === 'app_update_policies') return policiesQuery;
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    const request = new NextRequest(
      'http://localhost:3000/api/updates/available?tenant_id=tenant-a'
    );
    request.headers.set('Authorization', 'Bearer test-token');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.criticalCount).toBe(1);
    expect(body.updates[0].policy?.id).toBe('pol-1');

    expect(
      updateOps.some(
        (op) => op.method === 'eq' && op.args[0] === 'tenant_id' && op.args[1] === 'tenant-a'
      )
    ).toBe(true);
    expect(
      policyOps.some(
        (op) => op.method === 'eq' && op.args[0] === 'tenant_id' && op.args[1] === 'tenant-a'
      )
    ).toBe(true);
  });
});
