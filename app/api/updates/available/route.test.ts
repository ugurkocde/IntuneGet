import { NextRequest } from 'next/server';

const { parseAccessTokenMock, createServerClientMock, sqliteModeMock, databaseMock } = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  createServerClientMock: vi.fn(),
  sqliteModeMock: vi.fn(() => false),
  databaseMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ isSqliteMode: sqliteModeMock, getDatabase: databaseMock }));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: createServerClientMock,
  isSupabaseConfigured: () => true,
  isSupabaseServerConfigured: () => true,
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
  for (const method of ['not', 'limit']) query[method] = (...args: unknown[]) => {
    operations.push({ method, args });
    return query;
  };
  query.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve(result).then(resolve);

  return query;
}

describe('GET /api/updates/available', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqliteModeMock.mockReturnValue(false);
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

    const uploadHistoryQuery = createAwaitableQuery(
      { data: [], error: null },
      []
    );

    createServerClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'update_check_results') return updatesQuery;
        if (table === 'app_update_policies') return policiesQuery;
        if (table === 'upload_history') return uploadHistoryQuery;
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

  it('hides unmanaged updates by default and includes them on request', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'home-tenant',
      userName: 'User',
    });

    const rows = [
      {
        id: 'upd-managed',
        user_id: 'user-1',
        tenant_id: 'tenant-a',
        winget_id: 'Microsoft.Edge',
        intune_app_id: 'app-1',
        display_name: 'Edge',
        current_version: '1.0.0',
        latest_version: '1.1.0',
        is_critical: false,
        is_managed: true,
        detected_at: '2026-02-01T00:00:00Z',
        notified_at: null,
        dismissed_at: null,
      },
      {
        id: 'upd-unmanaged',
        user_id: 'user-1',
        tenant_id: 'tenant-a',
        winget_id: 'VideoLAN.VLC',
        intune_app_id: 'app-2',
        display_name: 'VLC',
        current_version: '2.0.0',
        latest_version: '2.1.0',
        is_critical: false,
        is_managed: false,
        detected_at: '2026-02-01T00:00:00Z',
        notified_at: null,
        dismissed_at: null,
      },
    ];

    // Fresh awaitable queries per client call so two GETs don't share state.
    createServerClientMock.mockImplementation(() => ({
      from: (table: string) => {
        if (table === 'update_check_results')
          return createAwaitableQuery({ data: rows, error: null }, []);
        if (table === 'app_update_policies')
          return createAwaitableQuery({ data: [], error: null }, []);
        if (table === 'upload_history')
          return createAwaitableQuery({ data: [], error: null }, []);
        throw new Error(`Unexpected table: ${table}`);
      },
    }));

    // Default: unmanaged hidden
    const defaultReq = new NextRequest('http://localhost:3000/api/updates/available');
    defaultReq.headers.set('Authorization', 'Bearer test-token');
    const defaultBody = await (await GET(defaultReq)).json();
    expect(defaultBody.count).toBe(1);
    expect(defaultBody.updates[0].winget_id).toBe('Microsoft.Edge');
    expect(defaultBody.updates[0].is_managed).toBe(true);

    // include_unmanaged=true: both managed and unmanaged shown
    const allReq = new NextRequest(
      'http://localhost:3000/api/updates/available?include_unmanaged=true'
    );
    allReq.headers.set('Authorization', 'Bearer test-token');
    const allBody = await (await GET(allReq)).json();
    expect(allBody.count).toBe(2);
  });
});


describe('paused policy failure details', () => {
  const update = { id: 'fixture-update', winget_id: 'Fixture.App', tenant_id: 'fixture-tenant', current_version: '1.0', latest_version: '1.1', is_managed: true };
  const paused = { id: 'fixture-policy', winget_id: 'Fixture.App', tenant_id: 'fixture-tenant', policy_type: 'auto_update', is_enabled: false, consecutive_failures: 3 };
  const history = [
    { policy_id: 'fixture-policy', status: 'cancelled', error_message: 'Latest fixture failure', triggered_at: '2026-11-13T12:00:00Z' },
    { policy_id: 'fixture-policy', status: 'failed', error_message: 'Earlier fixture failure', triggered_at: '2026-11-13T11:00:00Z' },
  ];
  afterEach(() => sqliteModeMock.mockReturnValue(false));
  it('returns the latest failure using one bounded lookup of the owner paused policies', async () => {
    parseAccessTokenMock.mockResolvedValue({ userId: 'fixture-owner' });
    const historyOps: Array<{ method: string; args: unknown[] }> = [];
    const tables: string[] = [];
    createServerClientMock.mockReturnValue({ from: (table: string) => {
      tables.push(table);
      return createAwaitableQuery({ data: table === 'update_check_results' ? [update] : table === 'app_update_policies' ? [paused] : table === 'auto_update_history' ? history : [], error: null }, table === 'auto_update_history' ? historyOps : []);
    } });
    const response = await GET(new NextRequest('http://localhost/api/updates/available'));
    expect(response.status).toBe(200);
    expect((await response.json()).updates[0].policy.last_error).toBe('Latest fixture failure');
    expect(tables.filter(t => t === 'auto_update_history')).toHaveLength(1);
    expect(historyOps).toContainEqual({ method: 'in', args: ['policy_id', ['fixture-policy']] });
    expect(historyOps).toContainEqual({ method: 'limit', args: [200] });
  });
  it('returns a recent failure for a paused self-hosted policy and scopes the history read to its owner', async () => {
    sqliteModeMock.mockReturnValue(true);
    parseAccessTokenMock.mockResolvedValue({ userId: 'fixture-owner' });
    const list = vi.fn().mockResolvedValue([{ ...history[0], status: 'completed', error_message: 'Ignore completed' }, ...history]);
    databaseMock.mockReturnValue({ updateCheckResults: { list: vi.fn().mockResolvedValue([update]) }, updatePolicies: { list: vi.fn().mockResolvedValue([paused]) }, autoUpdateHistory: { list } });
    const response = await GET(new NextRequest('http://localhost/api/updates/available?tenant_id=fixture-tenant'));
    expect(response.status).toBe(200);
    expect((await response.json()).updates[0].policy.last_error).toBe('Latest fixture failure');
    expect(list).toHaveBeenCalledWith('fixture-owner', { tenantId: 'fixture-tenant', limit: 200, offset: 0 });
  });
  it('skips history for active policies and propagates a paused history lookup failure', async () => {
    sqliteModeMock.mockReturnValue(false);
    parseAccessTokenMock.mockResolvedValue({ userId: 'fixture-owner' });
    const historyRead = vi.fn();
    let enabled = true;
    createServerClientMock.mockReturnValue({ from: (table: string) => {
      if (table === 'auto_update_history') historyRead();
      return createAwaitableQuery({ data: table === 'update_check_results' ? [update] : table === 'app_update_policies' ? [{ ...paused, is_enabled: enabled, consecutive_failures: enabled ? 0 : 3 }] : [], error: table === 'auto_update_history' ? { message: 'fixture unavailable' } : null }, []);
    } });
    const request = () => new NextRequest('http://localhost/api/updates/available');
    const active = await GET(request());
    expect(active.status).toBe(200);
    expect((await active.json()).updates[0].policy.last_error).toBeNull();
    expect(historyRead).not.toHaveBeenCalled();
    enabled = false;
    const unavailable = await GET(request());
    expect(unavailable.status).toBe(500);
    expect(await unavailable.json()).toEqual({ error: 'Failed to fetch update failure history' });
  });

});
